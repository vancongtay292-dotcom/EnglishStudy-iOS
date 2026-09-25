import {get,put} from './db.js';
const KEY_ID='device-aes-key-v1';
async function getKey(){let rec=await get('meta',KEY_ID);if(rec?.cryptoKey)return rec.cryptoKey;const cryptoKey=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);await put('meta',{key:KEY_ID,cryptoKey});return cryptoKey}
export async function saveSecret(name,value){const key=await getKey();const iv=crypto.getRandomValues(new Uint8Array(12));const data=new TextEncoder().encode(String(value||''));const enc=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,data);await put('settings',{key:`secret:${name}`,iv:[...iv],data:[...new Uint8Array(enc)]})}
export async function loadSecret(name){const rec=await get('settings',`secret:${name}`);if(!rec)return'';try{const key=await getKey();const dec=await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(rec.iv)},key,new Uint8Array(rec.data));return new TextDecoder().decode(dec)}catch{return''}}
export async function saveSetting(name,value){await put('settings',{key:`pref:${name}`,value})}
export async function loadSetting(name,def=''){return (await get('settings',`pref:${name}`))?.value ?? def}
