import { getStore } from '@netlify/blobs';
import { randomBytes, randomUUID } from 'node:crypto';
import { questions, type Question, type Category } from '../lib/questions.js';

// Site-wide room storage; strong consistency is enabled for every read.
const rooms = getStore({ name: 'battle-quiz-rooms', consistency: 'strong' });
const QUESTION_SECONDS = 15;
const MAX_PLAYERS = 8;
type Answer = { choice:number; points:number; answeredAt:number; elapsedMs:number };
type Player = { id:string; sessionToken:string; name:string; score:number; connected:boolean; joinedAt:number; host:boolean; answers:Record<string,Answer> };
type Room = { code:string; hostId:string; phase:'lobby'|'question'|'reveal'|'finished'|'closed'; category:string; players:Player[]; questionIds:string[]; questionIndex:number; deadline:number|null; createdAt:number; updatedAt:number; revealUntil:number|null };
const categories: Category[] = ['General Knowledge','Science & Technology','Programming','Sports','Movies & Entertainment','History'];
const json = (body:unknown,status=200) => new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const cleanName = (v:unknown) => typeof v==='string' ? v.trim().replace(/[<>\u0000-\u001f]/g,'').replace(/\s+/g,' ').slice(0,18) : '';
const cleanCode = (v:unknown) => typeof v==='string' ? v.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6) : '';
const token = () => randomBytes(32).toString('hex');
function questionFor(room:Room):Question|null { const id=room.questionIds[room.questionIndex]; return id ? questions.find(q=>q.id===id)||null : null; }
function publicState(room:Room,reveal=room.phase==='reveal'||room.phase==='finished') {
 const players=[...room.players].sort((a,b)=>b.score-a.score || a.name.localeCompare(b.name)).map(p=>{let correctAnswers=0,correctResponseMs=0;for(const [idx,a] of Object.entries(p.answers)){const q=questions.find(x=>x.id===room.questionIds[Number(idx)]);if(q&&a.choice===q.correctIndex){correctAnswers++;correctResponseMs+=a.elapsedMs;}}return {id:p.id,name:p.name,score:p.score,connected:p.connected,host:p.host,answeredCount:Object.keys(p.answers).length,hasAnswered:Boolean(p.answers[String(room.questionIndex)]),correctAnswers,correctResponseMs};});
 const q=questionFor(room); const state:Record<string,unknown>={code:room.code,phase:room.phase,category:room.category,hostId:room.hostId,players,questionIndex:room.questionIndex,totalQuestions:room.questionIds.length,deadline:room.deadline,serverNow:Date.now(),question:q?{id:q.id,category:q.category,question:q.question,options:q.options}:null,roomCreatedAt:room.createdAt};
 if(reveal&&q)state.answer={correctIndex:q.correctIndex,explanation:q.explanation};if(room.phase==='finished')state.winner=players[0]||null;return state;
}
async function readRoom(code:string){return await rooms.getWithMetadata(code,{consistency:'strong',type:'json'}) as {data:Room|null;etag:string}|null;}
async function saveRoom(room:Room,etag?:string){room.updatedAt=Date.now();const result=await rooms.setJSON(room.code,room,etag?{onlyIfMatch:etag}:{onlyIfNew:true});return result.modified;}
async function mutate(code:string,fn:(room:Room)=>unknown){for(let attempt=0;attempt<6;attempt++){const entry=await readRoom(code);if(!entry?.data)return {error:'Room not found. Check the code and try again.'};const room=entry.data;if(room.updatedAt<Date.now()-30*60_000){return {error:'This room has expired. Create a new room.'};}const result=fn(room);if(result&&typeof result==='object'&&'error'in (result as object))return result;if(await saveRoom(room,entry.etag))return result;}return {error:'Room is busy. Please try again.'};}
function advance(room:Room){const now=Date.now();if(room.phase==='question'&&room.deadline!==null&&now>=room.deadline){room.phase='reveal';room.deadline=null;room.revealUntil=now+1800;}else if(room.phase==='reveal'&&room.revealUntil!==null&&now>=room.revealUntil){room.questionIndex++;room.revealUntil=null;if(room.questionIndex>=room.questionIds.length){room.phase='finished';room.deadline=null;}else{room.phase='question';room.deadline=now+QUESTION_SECONDS*1000;}}}
function makeQuestionSet(category:string){const pool=category==='Mixed Random Questions'?questions:questions.filter(q=>q.category===category);return [...pool].sort(()=>Math.random()-.5).slice(0,10).map(q=>q.id);}
export default async (request:Request) => {
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{'access-control-allow-origin':'*','access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'content-type'}});
 if(request.method!=='POST')return json({error:'Use POST for game actions.'},405);
 let body:any;try{body=await request.json();}catch{return json({error:'Invalid JSON body.'},400);}
 const action=String(body.action||'');
 try {
  if(action==='create-room'){
   const name=cleanName(body.name);if(name.length<2)return json({error:'Please enter a nickname with at least 2 characters.'},400);
   const requested=typeof body.category==='string'?body.category:'Mixed Random Questions';const category=requested==='Mixed Random Questions'||categories.includes(requested as Category)?requested:'Mixed Random Questions';
   for(let i=0;i<5;i++){const code=Array.from(randomBytes(6),b=>'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b%32]).join('');const player:Player={id:randomUUID(),sessionToken:token(),name,score:0,connected:true,joinedAt:Date.now(),host:true,answers:{}};const room:Room={code,hostId:player.id,phase:'lobby',category,players:[player],questionIds:[],questionIndex:0,deadline:null,createdAt:Date.now(),updatedAt:Date.now(),revealUntil:null};if(await saveRoom(room))return json({events:[['session',{roomCode:code,playerId:player.id,sessionToken:player.sessionToken}],['room-created',{code}],['state',publicState(room)]]});}
   return json({error:'Could not create a room. Please try again.'},503);
  }
  if(action==='join-room'){
   const code=cleanCode(body.code),name=cleanName(body.name);if(code.length!==6)return json({error:'Enter a valid 6-character room code.'},400);
   const result=await mutate(code,room=>{advance(room);const existing=room.players.find(p=>p.sessionToken===body.sessionToken&&typeof body.sessionToken==='string');if(existing){existing.connected=true;return {session:{roomCode:code,playerId:existing.id,sessionToken:existing.sessionToken},state:publicState(room)};}if(name.length<2)return {error:'Please enter a nickname with at least 2 characters.'};if(room.phase!=='lobby')return {error:'This game has already started. New players cannot join mid-game.'};if(room.players.length>=MAX_PLAYERS)return {error:'This room is full. The maximum is 8 players.'};if(room.players.some(p=>p.name.toLowerCase()===name.toLowerCase()))return {error:'That nickname is already being used in this room. Try another one.'};const p:Player={id:randomUUID(),sessionToken:token(),name,score:0,connected:true,joinedAt:Date.now(),host:false,answers:{}};room.players.push(p);return {session:{roomCode:code,playerId:p.id,sessionToken:p.sessionToken},state:publicState(room)};});
   if((result as any).error)return json(result);const r=result as any;return json({events:[...(r.session?[['session',r.session]]:[]),['state',r.state]]});
  }
  if(action==='poll'){
   const code=cleanCode(body.code);const entry=await readRoom(code);if(!entry?.data)return json({error:'This room has expired or no longer exists.'});const room=entry.data;const before=JSON.stringify(room);advance(room);const p=room.players.find(x=>x.sessionToken===body.sessionToken);if(p&&!p.connected)p.connected=true;
   if(JSON.stringify(room)!==before){const saved=await saveRoom(room,entry.etag);if(!saved)return json({events:[]});}
   return json({events:[['state',publicState(room)]]});
  }
  if(action==='start-game'){
   const result=await mutate(cleanCode(body.code),room=>{advance(room);const p=room.players.find(x=>x.sessionToken===body.sessionToken);if(!p||p.id!==room.hostId)return {error:'Only the host can start the game.'};if(room.phase!=='lobby')return {error:'This game has already started.'};if(room.players.filter(x=>x.connected).length<2)return {error:'At least 2 connected players are required to start.'};room.questionIds=makeQuestionSet(room.category);room.questionIndex=0;room.players.forEach(x=>{x.score=0;x.answers={};});room.phase='question';room.deadline=Date.now()+QUESTION_SECONDS*1000;return {state:publicState(room)};});if((result as any).error)return json(result);return json({events:[['state',(result as any).state]]});
  }
  if(action==='submit-answer'){
   const result=await mutate(cleanCode(body.code),room=>{advance(room);const p=room.players.find(x=>x.sessionToken===body.sessionToken);const q=questionFor(room);if(!p)return {error:'Your player session is not active in this room.'};if(room.phase!=='question'||!q)return {error:'This question is no longer accepting answers.'};if(body.questionId!==q.id)return {error:'That answer belongs to a different question.'};if(p.answers[String(room.questionIndex)])return {error:'You have already answered this question.'};if(!Number.isInteger(body.choice)||body.choice<0||body.choice>3)return {error:'Choose one of the four answer options.'};const now=Date.now();if(!room.deadline||now>room.deadline)return {error:'Time is up for this question.'};const elapsed=Math.max(0,now-(room.deadline-QUESTION_SECONDS*1000));let points=0;if(body.choice===q.correctIndex)points=Math.round(100+900*Math.max(0,Math.min(1,(room.deadline-now)/(QUESTION_SECONDS*1000))));p.answers[String(room.questionIndex)]={choice:body.choice,points,answeredAt:now,elapsedMs:elapsed};p.score+=points;if(room.players.filter(x=>x.connected).every(x=>Boolean(x.answers[String(room.questionIndex)]))){room.phase='reveal';room.deadline=null;room.revealUntil=now+1800;}return {state:publicState(room),accepted:{questionIndex:room.questionIndex,points,totalScore:p.score,correct:body.choice===q.correctIndex,elapsedMs:elapsed}};});if((result as any).error)return json(result);return json({events:[['answer-accepted',(result as any).accepted],['state',(result as any).state]]});
  }
  if(action==='leave-room'){
   const code=cleanCode(body.code);const result=await mutate(code,room=>{const p=room.players.find(x=>x.sessionToken===body.sessionToken);if(p){if(p.host){room.phase='closed';room.players=[];}else room.players=room.players.filter(x=>x.id!==p.id);}return {state:publicState(room)};});if((result as any).error)return json({events:[]});if((result as any).state?.phase==='closed')await rooms.delete(code);return json({events:[['state',(result as any).state]]});
  }
  if(action==='reconnect-room'){return json({events:[]});}
  return json({error:'Unknown game action.'},400);
 } catch (error) { console.error('Battle Quiz function error',error);return json({error:'The game service had a temporary problem. Please try again.'},500); }
};
