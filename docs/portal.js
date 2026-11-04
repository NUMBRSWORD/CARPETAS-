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
 const input=document.getElementById('codigo'),estado=document.getElementById('estado'),boton=document.getElementById('entrar');let origen='';
 // El fragmento no se envía a GitHub; se retira antes de cargar la configuración.
 const codigoHash=codigoPersonal(location.hash.slice(1));
 if(location.hash)history.replaceState(null,'',location.pathname+location.search);
 const entrar=codigo=>{if(!codigo){estado.textContent='Revisa el enlace o código que te entregó Mesa de Partes.';input.focus();return}location.replace(origen+'/e/'+codigo)};
 document.getElementById('acceso').addEventListener('submit',e=>{e.preventDefault();if(origen)entrar(codigoPersonal(input.value))});
 fetch('config.json',{cache:'no-store',credentials:'omit'}).then(r=>{if(!r.ok)throw Error();return r.json()}).then(c=>{
  origen=c.disponible===true?origenPortal(c.portal):'';
  if(!origen){estado.textContent='El acceso por internet está en preparación. Mesa de Partes te avisará cuando esté habilitado.';return}
  boton.disabled=false;estado.textContent='Usa tu acceso personal para continuar.';if(codigoHash)entrar(codigoHash);
 }).catch(()=>{estado.textContent='No se pudo comprobar el acceso. Vuelve a intentarlo en unos minutos.'});
}
