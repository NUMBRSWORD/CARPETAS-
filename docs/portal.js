'use strict';
function codigoPersonal(texto){
 const t=String(texto||'').trim();
 if(/^[A-Za-z0-9_-]{20,60}$/.test(t))return t;
 try{const u=new URL(t),m=u.pathname.match(/^\/e\/([A-Za-z0-9_-]{20,60})\/?$/);if(m&&['http:','https:'].includes(u.protocol))return m[1]}catch(e){}
 return '';
}
function origenPortal(texto){
 try{const u=new URL(texto);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&u.pathname==='/'&&!u.search&&!u.hash?u.origin:''}catch(e){return ''}
}
if(typeof module!=='undefined')module.exports={codigoPersonal,origenPortal};
if(typeof document!=='undefined'){
 const ingreso=document.getElementById('ingresar'),estado=document.getElementById('estado');let origen='';
 ingreso.addEventListener('click',()=>{if(origen)location.assign(origen+'/ingresar')});
 // Enlaces personales antiguos (#código): siguen llevando al portal. El fragmento no se envía a GitHub.
 const codigoHash=codigoPersonal(location.hash.slice(1));
 if(location.hash)history.replaceState(null,'',location.pathname+location.search);
 fetch('config.json',{cache:'no-store',credentials:'omit'}).then(r=>{if(!r.ok)throw Error();return r.json()}).then(c=>{
  // La copia del repositorio de código conduce a la entrada estable, que mantiene el túnel vigente.
  if(c.disponible===true&&c.entrada==='https://numbrsword.github.io/mis-carpetas/'){
   estado.textContent='Abriendo el acceso personal…';location.replace(c.entrada+(codigoHash?'#'+codigoHash:''));return;
  }
  origen=c.disponible===true?origenPortal(c.portal):'';
  if(!origen){estado.textContent='El acceso por internet está en preparación. Mesa de Partes te avisará cuando esté habilitado.';return}
  if(codigoHash)return location.replace(origen+'/e/'+codigoHash);
  ingreso.disabled=false;estado.textContent='Ingresa con tu CIP y tu contraseña.';
 }).catch(()=>{estado.textContent='No se pudo comprobar el acceso. Vuelve a intentarlo en unos minutos.'});
}
