const DB_NAME='EnglishStudyIOS'; const DB_VERSION=2;
let dbp;
export function openDb(){if(dbp)return dbp;dbp=new Promise((resolve,reject)=>{const r=indexedDB.open(DB_NAME,DB_VERSION);r.onupgradeneeded=()=>{const db=r.result;
  if(!db.objectStoreNames.contains('vocab')){const s=db.createObjectStore('vocab',{keyPath:'id',autoIncrement:true});s.createIndex('normalizedWord','normalizedWord',{unique:true});s.createIndex('aiState','aiState');s.createIndex('isLearned','isLearned');}
  if(!db.objectStoreNames.contains('phrasal')){const s=db.createObjectStore('phrasal',{keyPath:'id',autoIncrement:true});s.createIndex('normalizedPhrase','normalizedPhrase',{unique:true});s.createIndex('aiState','aiState');}
  if(!db.objectStoreNames.contains('audio'))db.createObjectStore('audio',{keyPath:'key'});
  if(!db.objectStoreNames.contains('dialogues'))db.createObjectStore('dialogues',{keyPath:'id'});
  if(!db.objectStoreNames.contains('settings'))db.createObjectStore('settings',{keyPath:'key'});
  if(!db.objectStoreNames.contains('meta'))db.createObjectStore('meta',{keyPath:'key'});
};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});return dbp}
function req(r){return new Promise((res,rej)=>{r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
export async function get(store,key){const db=await openDb();return req(db.transaction(store).objectStore(store).get(key))}
export async function put(store,value){const db=await openDb();return req(db.transaction(store,'readwrite').objectStore(store).put(value))}
export async function del(store,key){const db=await openDb();return req(db.transaction(store,'readwrite').objectStore(store).delete(key))}
export async function getAll(store){const db=await openDb();return req(db.transaction(store).objectStore(store).getAll())}
export async function clearStore(store){const db=await openDb();return req(db.transaction(store,'readwrite').objectStore(store).clear())}
export async function addVocabBulk(items){const db=await openDb();const existing=await req(db.transaction('vocab').objectStore('vocab').getAll());const set=new Set(existing.map(v=>v.normalizedWord));let added=0,duplicates=0;const tx=db.transaction('vocab','readwrite'),s=tx.objectStore('vocab');for(const item of items){if(set.has(item.normalizedWord)){duplicates++;continue}set.add(item.normalizedWord);s.add(item);added++}await new Promise((res,rej)=>{tx.oncomplete=res;tx.onerror=()=>rej(tx.error);tx.onabort=()=>rej(tx.error)});return{added,duplicates}}
export async function updateVocab(item){return put('vocab',item)}
export async function addPhrasalBulk(phrases){const db=await openDb();const existing=await req(db.transaction('phrasal').objectStore('phrasal').getAll());const set=new Set(existing.map(v=>v.normalizedPhrase));let added=0,duplicates=0;const tx=db.transaction('phrasal','readwrite'),st=tx.objectStore('phrasal');for(const phrase of phrases){const normalizedPhrase=String(phrase||'').trim().toLowerCase().replace(/\s+/g,' ');if(!normalizedPhrase||set.has(normalizedPhrase)){duplicates++;continue}set.add(normalizedPhrase);st.add({phrase:String(phrase).trim(),normalizedPhrase,aiState:'PENDING',aiAttempts:0,createdAt:Date.now()});added++}await new Promise((res,rej)=>{tx.oncomplete=res;tx.onerror=()=>rej(tx.error);tx.onabort=()=>rej(tx.error)});return{added,duplicates}}
export async function updatePhrasal(item){return put('phrasal',item)}
export async function getPhrasalByState(state){const db=await openDb();return req(db.transaction('phrasal').objectStore('phrasal').index('aiState').getAll(state))}
export async function getVocabByState(state){const db=await openDb();return req(db.transaction('vocab').objectStore('vocab').index('aiState').getAll(state))}
export async function getAudio(key){return get('audio',key)}
export async function putAudio(key,blob,meta={}){return put('audio',{key,blob,createdAt:Date.now(),...meta})}
export async function exportAll(){return{version:1,exportedAt:new Date().toISOString(),vocab:await getAll('vocab'),phrasal:await getAll('phrasal'),dialogues:await getAll('dialogues'),settings:(await getAll('settings')).filter(x=>!x.key.startsWith('secret:'))}}
export async function restoreAll(data){if(!data||!Array.isArray(data.vocab))throw new Error('Backup không hợp lệ');const db=await openDb();for(const st of ['vocab','phrasal','dialogues']){const tx=db.transaction(st,'readwrite');tx.objectStore(st).clear();await new Promise((res,rej)=>{tx.oncomplete=res;tx.onerror=()=>rej(tx.error)})}for(const v of data.vocab)await put('vocab',v);for(const x of(data.phrasal||[]))await put('phrasal',x);for(const d of(data.dialogues||[]))await put('dialogues',d);for(const s of(data.settings||[]))await put('settings',s)}
