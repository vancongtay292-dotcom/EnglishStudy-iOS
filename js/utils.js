export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const now = () => Date.now();
export const DAY = 86400000;
export function normalizeWord(v){return String(v??'').normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('en-US')}
export function cleanWord(v){return String(v??'').normalize('NFKC').trim().replace(/^\s*\d+[.)-]?\s*/,'').trim()}
export function clamp(v,min,max){return Math.max(min,Math.min(max,v))}
export function shuffle(a){const x=[...a];for(let i=x.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[x[i],x[j]]=[x[j],x[i]]}return x}
export function escapeHtml(s){return String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
export function downloadBlob(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},800)}
export function fileStamp(){return new Date().toISOString().replace(/[:.]/g,'-')}
export function toast(msg){const el=document.getElementById('toast');el.textContent=msg;el.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove('show'),2600)}
export function parseJsonFromText(text){const cleaned=String(text).trim().replace(/^```json\s*/i,'').replace(/^```\s*/,'').replace(/```$/,'').trim();const a=cleaned.indexOf('{'),b=cleaned.lastIndexOf('}');if(a<0||b<=a)throw new Error('AI không trả JSON hợp lệ');return JSON.parse(cleaned.slice(a,b+1))}
export function b64ToBytes(b64){const raw=atob(b64);const out=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);return out}
export function bytesToB64(bytes){let s='';const step=0x8000;for(let i=0;i<bytes.length;i+=step)s+=String.fromCharCode(...bytes.subarray(i,i+step));return btoa(s)}
export async function sha256Hex(text){const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return [...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,'0')).join('')}
