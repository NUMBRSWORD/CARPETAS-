// Un envío a la vez. Un conflicto nunca recarga ni descarta las ediciones.
let srvTimer=null,srvEnCurso=false,srvPend=false,srvConflicto=false,srvIntentos=0,srvUltimo='';
let recuperacion=null;
const REC_KEY=KEY+'_pendiente';
function conservarPendiente(){
  if(!SRV||recuperacion)return;
  try{sessionStorage.setItem(REC_KEY,JSON.stringify({version:srvVersion,store,fecha:new Date().toISOString()}))}catch(e){/* La advertencia al cerrar sigue activa. */}
}
function borrarPendiente(){try{sessionStorage.removeItem(REC_KEY)}catch(e){}}
function save(){
  if(!SRV){try{localStorage.setItem(KEY,JSON.stringify(store));persistente=true}catch(e){persistente=false}avisoGuardado();return}
  srvPend=true;conservarPendiente();avisoGuardado();
  clearTimeout(srvTimer);
  if(!srvConflicto)srvTimer=setTimeout(enviarEstado,250);
}
async function enviarEstado(){
  clearTimeout(srvTimer);
  if(srvEnCurso||srvConflicto||!srvPend)return;
  srvEnCurso=true;srvPend=false;avisoGuardado();
  const abortar=new AbortController(),limite=setTimeout(()=>abortar.abort(),15000);
  try{
    const r=await fetch('api/estado',{method:'PUT',headers:{'Content-Type':'application/json','X-Carpetas':'1'},signal:abortar.signal,body:JSON.stringify({version:srvVersion,store})});
    if(r.status===409){srvConflicto=true;throw new Error('Otra ventana guardó cambios.')}
    if(!r.ok)throw new Error('No se pudo guardar ('+r.status+').');
    srvVersion=(await r.json()).version;persistente=true;srvIntentos=0;srvUltimo=new Date().toLocaleTimeString('es-PE');
    if(srvPend)conservarPendiente();else if(!recuperacion)borrarPendiente();
  }catch(e){persistente=false;srvPend=true;conservarPendiente();srvIntentos++}
  finally{clearTimeout(limite);srvEnCurso=false;avisoGuardado()}
  if(srvPend&&!srvConflicto)srvTimer=setTimeout(enviarEstado,persistente?0:Math.min(30000,1000*2**Math.min(srvIntentos,5)));
}
async function guardarAhora(){
  if(!SRV){save();if(!persistente)throw new Error('No se pudo guardar en el navegador.');return}
  clearTimeout(srvTimer);
  while(srvEnCurso)await new Promise(ok=>setTimeout(ok,50));
  if(srvConflicto)throw new Error('Hay cambios de otra ventana. Resuelve el aviso de guardado antes de continuar.');
  if(srvPend)await enviarEstado();
  if(srvPend||!persistente)throw new Error('Los cambios aún no se han guardado. Revisa el aviso superior.');
}
function avisoGuardado(){
  const w=$('warn'),s=$('guardado');
  const pendiente=SRV&&(srvPend||srvEnCurso);
  if(s){
    s.textContent=srvConflicto?'Revisar cambios':!persistente?'Sin guardar':pendiente?'Guardando…':SRV?'Guardado en esta PC':'Guardado en navegador';
    s.dataset.estado=srvConflicto||!persistente?'error':pendiente?'pendiente':'ok';
    s.title=srvUltimo?'Último guardado: '+srvUltimo:SRV?'Base de datos local':'Los datos se guardan en este navegador';
  }
  w.hidden=persistente&&!srvConflicto&&!recuperacion;
  if(recuperacion){
    w.innerHTML='<span>Hay cambios pendientes de una sesión anterior. Descárgalos para revisarlos antes de continuar.</span> <button class="btn" id="recuperarPendiente">Descargar cambios pendientes</button> <button class="btn" id="ocultarRecuperacion">Continuar con los datos actuales</button>';
  }else if(srvConflicto){
    w.innerHTML='<span>Otra ventana o equipo guardó cambios. Tus ediciones siguen aquí y no se sobrescribirá lo guardado. Descarga tus cambios antes de cargar la versión actual.</span> <button class="btn" id="guardarCopiaPendiente">Descargar mis cambios</button> <button class="btn" id="cargarVersionActual">Cargar versión actual</button>';
  }else if(!persistente){
    w.innerHTML=SRV?'<span>No se pudo guardar. Mantén abierta esta página y comprueba que el servidor esté funcionando. Se reintentará automáticamente.</span> <button class="btn" id="reintentarGuardado">Reintentar ahora</button> <button class="btn" id="guardarCopiaPendiente">Descargar mis cambios</button>':'Este navegador no permite guardar aquí. Descarga un respaldo en Ajustes antes de cerrar.';
  }
}
function iniciarRecuperacion(){
  if(!SRV)return;
  try{
    const raw=sessionStorage.getItem(REC_KEY);if(!raw)return;
    const r=JSON.parse(raw);
    if(!r.store||!Number.isInteger(r.version))return;
    if(JSON.stringify(r.store)===JSON.stringify(SRV.store)){borrarPendiente();return}
    recuperacion=r;avisoGuardado();
  }catch(e){}
}
document.addEventListener('click',e=>{
  const id=e.target.closest('button')?.id;
  if(id==='reintentarGuardado')enviarEstado();
  if(id==='guardarCopiaPendiente')descargar('cambios_pendientes_carpetas_'+today()+'.json','application/json',JSON.stringify(store));
  if(id==='recuperarPendiente'&&recuperacion)descargar('cambios_recuperados_carpetas_'+today()+'.json','application/json',JSON.stringify(recuperacion.store));
  if(id==='ocultarRecuperacion'&&confirm('¿Ya conservaste los cambios pendientes que necesitas?')){recuperacion=null;if(srvPend)conservarPendiente();else borrarPendiente();avisoGuardado()}
  if(id==='cargarVersionActual'&&confirm('¿Ya descargaste tus cambios? Se cargarán los datos actuales de la base y las ediciones de esta ventana dejarán de mostrarse.')){srvPend=false;srvConflicto=false;borrarPendiente();location.reload()}
});
window.addEventListener('online',()=>{if(srvPend&&!srvConflicto)enviarEstado()});
window.addEventListener('beforeunload',e=>{if(SRV&&(srvPend||srvEnCurso)){conservarPendiente();e.preventDefault();e.returnValue=''}});

function validarRespaldo(s){
  const objeto=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
  const error=()=>{throw new Error('El archivo no tiene la estructura de un respaldo válido.')};
  if(!objeto(s)||!objeto(s.edits)||!Array.isArray(s.nuevos))error();
  if(s.cfg!==undefined&&!objeto(s.cfg))error();
  if(s.efectivos!==undefined&&!Array.isArray(s.efectivos))error();
  function clavesSeguras(v,nivel=0){
    if(nivel>30)error();
    if(!v||typeof v!=='object')return;
    for(const [k,x] of Object.entries(v)){if(['__proto__','constructor','prototype'].includes(k))error();clavesSeguras(x,nivel+1)}
  }
  clavesSeguras(s);
  if(s.cfg?.aviso!==undefined&&(!Number.isInteger(s.cfg.aviso)||s.cfg.aviso<0||s.cfg.aviso>365))error();
  if(Object.values(s.edits).some(v=>!objeto(v)))error();
  for(const lista of [s.nuevos,s.efectivos||[]]){
    const ids=new Set();
    for(const r of lista){if(!objeto(r)||typeof r.id!=='string'||!r.id||ids.has(r.id))error();ids.add(r.id)}
  }
  if(s.adjuntos!==undefined){
    if(!Array.isArray(s.adjuntos))error();
    const claves=new Set();
    for(const a of s.adjuntos){
      if(!objeto(a)||typeof a.clave!=='string'||!a.clave||a.clave.length>200||claves.has(a.clave)||typeof a.datos!=='string'||!a.datos||a.datos.length>Math.ceil(25*1024*1024/3)*4||a.datos.length%4||/[^A-Za-z0-9+/=]/.test(a.datos)||!/^[^=]*={0,2}$/.test(a.datos))error();
      const bytes=a.datos.length/4*3-(a.datos.endsWith('==')?2:a.datos.endsWith('=')?1:0);
      if(bytes<1||bytes>25*1024*1024)error();
      claves.add(a.clave);
    }
  }
}

async function capacidadesServidor(){
  const r=await fetch('api/info');
  if(!r.ok||r.redirected)throw new Error('No se pudo consultar el servidor.');
  return r.json();
}
async function restaurarEnServidor(nuevo,adjuntos){
  await guardarAhora();
  const info=await capacidadesServidor();
  if(!info.restauracion_atomica)throw new Error('Primero activa la actualización con REINICIAR SERVIDOR.bat. Así se restaurarán los datos y documentos juntos.');
  const cuerpo=JSON.stringify({version:srvVersion,store:nuevo,adjuntos:adjuntos||[]});
  if(new Blob([cuerpo]).size>(info.max_restauracion||128*1024*1024))throw new Error('El respaldo supera los 128 MB. Conserva el archivo para una recuperación local.');
  srvEnCurso=true;avisoGuardado();
  try{
    const r=await fetch('api/restaurar',{method:'POST',headers:{'Content-Type':'application/json','X-Carpetas':'1'},body:cuerpo});
    if(r.status===409)throw new Error('Otra ventana guardó cambios. Recarga la página y revisa antes de restaurar.');
    if(!r.ok)throw new Error(await r.text());
    const respuesta=await r.json();
    store=nuevo;srvVersion=respuesta.version;srvPend=false;srvConflicto=false;persistente=true;recuperacion=null;borrarPendiente();
  }catch(e){
    // Una respuesta perdida no permite saber si la transacción terminó. No sobrescribirla.
    srvConflicto=true;srvPend=true;persistente=false;conservarPendiente();
    throw new Error((e.message||'No se pudo confirmar la restauración.')+' Conserva el respaldo y carga la versión actual antes de seguir editando.');
  }finally{srvEnCurso=false;avisoGuardado()}
}
