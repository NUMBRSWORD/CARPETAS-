// --- Efectivos a cargo ---
const nrm=v=>String(v??'').normalize('NFD').replace(/[̀-ͯ]/g,'').toUpperCase().replace(/\s+/g,' ').trim();
const claveEf=e=>nrm(e.nombre).split(' ').slice(0,2).join(' ');
function efectivosDe(r){
  const t=nrm(r.resp);
  if(!t)return [];
  const l=store.efectivos.filter(e=>{const k=claveEf(e);return k&&t.includes(k)});
  // Con los mismos apellidos se usa también el nombre, si figura en el registro.
  return l.filter(e=>{
    const g=l.filter(x=>claveEf(x)===claveEf(e));
    if(g.length<2)return true;
    const con=g.filter(x=>{const n=nrm(x.nombre).split(' ')[2];return n&&t.includes(n)});
    return !con.length||con.includes(e);
  });
}
function efectivoDe(r){const l=efectivosDe(r);return l.length===1?l[0]:null}
function cargas(){
  const m=new Map(store.efectivos.map(e=>[e.id,{p:0,v:0}]));
  for(const r of recs){
    if(!pendiente(r))continue;
    const venc=vigencia(r)==='VENCIDA';
    for(const e of efectivosDe(r)){const c=m.get(e.id);c.p++;if(venc)c.v++}
  }
  return m;
}
const nombreEf=e=>[e.grado,e.nombre].filter(Boolean).join(' ');
// Secciones según el rol de servicio del 02NOV26; cada una se puede cambiar en Efectivos.
const SECCIONES=['FAMILIA','DEINPOL','TRÁNSITO'];
const ROL_SECCION=Object.fromEntries(SECCIONES.map(s=>[s,PERSONALIZACION.rol_seccion?.[s]||[]]));
const seccionRol=e=>SECCIONES.find(s=>ROL_SECCION[s].includes(claveEf(e)))||'';
const seccionEf=e=>e.seccion??seccionRol(e);
// Una sola vez por navegador: quienes reciben carpetas según el rol quedan activos.
// Correcciones históricas del rol se leen desde la personalización local.
if((store.cfg.rolV||0)<2){
  for(const e of store.efectivos){
    if(seccionRol(e))e.activo=true;
    else if(store.cfg.rolV===1&&(PERSONALIZACION.rol_inactivo_v1||[]).includes(claveEf(e)))e.activo=false;
  }
  store.cfg.rolV=2;save();
}
// El grado va según el rol del 02NOV26 donde difiere de la lista de personal. Se aplica una vez: luego se edita en Efectivos.
const GRADO_ROL=PERSONALIZACION.grado_rol||{};
if(store.cfg.rolV<4){
  for(const e of store.efectivos){
    const g=Object.keys(GRADO_ROL).find(k=>nrm(k)===claveEf(e));
    if(g)e.grado=GRADO_ROL[g]+' PNP';
  }
  store.cfg.rolV=4;save();
}
function vEfectivos(){
  const c=cargas();
  const orden=[...store.efectivos].sort((a,b)=>(b.activo?1:0)-(a.activo?1:0)||c.get(b.id).p-c.get(a.id).p||a.nombre.localeCompare(b.nombre));
  $('app').innerHTML=cabecera('Personal','Efectivos a cargo','Marca como activos a quienes reciben carpetas: solo ellos aparecen para escoger. El cargo es opcional y sale en sus decretos y memorandos')+
   '<div class="panel"><div class="row" style="margin-bottom:12px"><button class="btn main" id="efNuevo">Agregar efectivo</button>'+(SRV?'<button class="btn" id="cuentasTodas">Crear usuarios de todos los activos (CIP / DNI)</button>':'')+'<label>Buscar<input id="efBuscar" type="search" placeholder="Apellido, CIP o DNI"></label></div><div class="scroll"><table class="ef-tabla tabla-personal tarjetas"><thead><tr><th>Activo</th><th>Grado</th><th>Apellidos y nombres</th><th>CIP</th><th>DNI</th><th>Cargo</th><th>Sección</th><th class="num">Pendientes</th><th class="num">Vencidas</th>'+(SRV?'<th>Enlace</th>':'')+'</tr></thead><tbody>'+
   orden.map(e=>'<tr data-ef="'+esc(e.id)+'"><td><input type="checkbox" data-eff="activo"'+(e.activo?' checked':'')+' aria-label="Activo"></td><td><input data-eff="grado" value="'+esc(e.grado)+'" aria-label="Grado"></td><td><input data-eff="nombre" value="'+esc(e.nombre)+'" aria-label="Apellidos y nombres"></td><td><input data-eff="cip" value="'+esc(e.cip||'')+'" aria-label="CIP"></td><td><input data-eff="dni" value="'+esc(e.dni||'')+'" aria-label="DNI"></td><td><input data-eff="cargo" value="'+esc(e.cargo||'')+'" aria-label="Cargo"></td><td><select data-eff="seccion" aria-label="Sección">'+['',...SECCIONES].map(s=>'<option value="'+esc(s)+'"'+(s===seccionEf(e)?' selected':'')+'>'+esc(s||'—')+'</option>').join('')+'</select></td><td class="num">'+c.get(e.id).p+'</td><td class="num">'+c.get(e.id).v+'</td>'+(SRV?'<td style="white-space:nowrap"><button class="btn" data-cuenta="'+esc(e.id)+'">'+(CUENTAS[e.id]?'Reiniciar contraseña':'Crear usuario')+'</button> <button class="btn" data-enlace="'+esc(e.id)+'">Enlace</button>'+(CUENTAS[e.id]?'<br><small class="muted">Usuario '+esc(CUENTAS[e.id].usuario)+(CUENTAS[e.id].cambiar?' · falta su primer ingreso':'')+(CUENTAS[e.id].bloqueada?' · bloqueada':'')+'</small>':'')+'</td>':'')+'</tr>').join('')+
   '</tbody></table></div></div>';
}

// --- Librerías locales: se cargan solo al usarlas, sin internet ---
const cargados=new Map();
function cargarRecurso(archivo){
  if(!cargados.has(archivo))cargados.set(archivo,new Promise((ok,mal)=>{
    const s=document.createElement('script');s.src='recursos/'+archivo;s.onload=ok;
    s.onerror=()=>{cargados.delete(archivo);s.remove();mal(new Error('Falta el archivo recursos/'+archivo+'. Mantén la carpeta "recursos" junto a la página.'))};
    document.head.appendChild(s);
  }));
  return cargados.get(archivo);
}
const blobTexto=(t,tipo)=>URL.createObjectURL(new Blob([t],{type:tipo}));
function bytesBase64(b){const s=atob(b),u=new Uint8Array(s.length);for(let i=0;i<s.length;i++)u[i]=s.charCodeAt(i);return u}
let pdfjsPromesa=null;
function pdfjs(){
  if(!pdfjsPromesa)pdfjsPromesa=(async()=>{
    await cargarRecurso('lector_pdf.js');
    const lib=await import(blobTexto(window.RECURSO_PDF.main,'text/javascript'));
    // Abierta desde un archivo local, Chrome no deja arrancar un worker de módulo:
    // el lector corre en la página misma, que es suficiente para oficios de pocas hojas.
    globalThis.pdfjsWorker=await import(blobTexto(window.RECURSO_PDF.worker,'text/javascript'));
    return lib;
  })().catch(e=>{pdfjsPromesa=null;throw e});
  return pdfjsPromesa;
}
let ocrPromesa=null;
function ocr(){
  if(!ocrPromesa)ocrPromesa=(async()=>{
    await cargarRecurso('lector_ocr.js');
    await cargarRecurso('idioma_spa.js');
    const R=window.RECURSO_OCR;
    // Desde un archivo local el worker no puede importar otros blobs: motor e idioma van dentro del mismo worker,
    // y su fetch entrega el idioma sin salir a ninguna red.
    const idioma='self.fetch=async()=>{const s=atob("'+window.RECURSO_SPA+'"),u=new Uint8Array(s.length);for(let i=0;i<s.length;i++)u[i]=s.charCodeAt(i);return new Response(u)};\n';
    return Tesseract.createWorker('spa',1,{
      workerBlobURL:false,gzip:false,cacheMethod:'none',langPath:'local',
      workerPath:blobTexto(idioma+R.core+'\n'+R.worker,'text/javascript'),
      corePath:'incluido.js',
    });
  })().catch(e=>{ocrPromesa=null;throw e});
  return ocrPromesa;
}
let colaOcr=Promise.resolve();
function reconocerTextoOcr(worker,lienzo,ajustes=null){
  const tarea=colaOcr.catch(()=>{}).then(async()=>{
    try{if(ajustes)await worker.setParameters(ajustes);return await worker.recognize(lienzo)}
    finally{if(ajustes)await worker.setParameters({tessedit_pageseg_mode:'3',tessedit_char_whitelist:''})}
  });
  colaOcr=tarea;return tarea;
}
async function textoDeArchivo(file,aviso){
  if(file.type.startsWith('image/')){
    aviso('Leyendo la imagen…');
    const w=await ocr();return {texto:(await reconocerTextoOcr(w,file)).data.text,ocr:true};
  }
  const lib=await pdfjs();
  const pdf=await lib.getDocument({data:await file.arrayBuffer(),isEvalSupported:false}).promise;
  let texto='';
  for(let i=1;i<=pdf.numPages;i++){
    const pag=await pdf.getPage(i);
    const c=await pag.getTextContent();
    let y=null;
    for(const it of c.items){
      if(y!==null&&Math.abs(it.transform[5]-y)>3)texto+='\n';
      texto+=it.str+' ';y=it.transform[5];
    }
    texto+='\n';
  }
  if(texto.replace(/\s/g,'').length>=80)return {texto,ocr:false};
  // Escaneado: se fotografía cada página y se lee con OCR. Basta con las primeras.
  const w=await ocr();texto='';
  const total=Math.min(pdf.numPages,4);
  for(let i=1;i<=total;i++){
    aviso('Escaneado: leyendo página '+i+' de '+total+'…');
    const pag=await pdf.getPage(i),vp=pag.getViewport({scale:2.4}),cv=document.createElement('canvas');
    cv.width=vp.width;cv.height=vp.height;
    await pag.render({canvasContext:cv.getContext('2d'),viewport:vp}).promise;
    texto+=(await reconocerTextoOcr(w,cv)).data.text+'\n';
    cv.width=cv.height=0;
  }
  return {texto,ocr:true};
}

// --- Lectura de los datos del oficio ---
const NMES={ENERO:1,FEBRERO:2,MARZO:3,ABRIL:4,MAYO:5,JUNIO:6,JULIO:7,AGOSTO:8,SEPTIEMBRE:9,SETIEMBRE:9,OCTUBRE:10,NOVIEMBRE:11,DICIEMBRE:12};
function fechaLetras(m){const mes=NMES[m[2]];return mes?m[3]+'-'+pad(mes)+'-'+pad(+m[1]):''}
function limpiarNombre(v){return String(v||'').replace(/\s+/g,' ').replace(/^[\s:;,.\-–]+|[\s:;,.\-–]+$/g,'').trim()}
function extraerCampos(bruto){
  // Por líneas para ubicar la fiscalía; todo seguido para los demás datos.
  const lineas=String(bruto).split(/\n+/).map(nrm).filter(Boolean);
  const u=lineas.join(' ');
  const c={};
  // El OCR suele leer "N°" como N*, Nº, N', No o N.
  let m=u.match(/OFICIO\s*N?\s*[°ºO.*'´`"~_]*\s*:?\s*(\d[\w\-\/.°]*)/);
  if(m)c.ofi='OF. N° '+m[1].replace(/[.\-]+$/,'');
  m=u.match(/(?:CARPETA\s+FISCAL|CARPETA|CASO|C\.\s?F\.?|\bCF\b)\s*(?:N\s*[°ºO.*'´`"~_]*)?\s*:?\s*(\d[\d\-]{2,})/);
  if(m)c.cf='C.F. N° '+m[1].replace(/-+$/,'');
  const lf=lineas.find(l=>/FISCAL[IÍ]A\s+(?!DE LA NACION)/.test(l)&&!/MINISTERIO PUBLICO$/.test(l));
  if(lf)c.fis=limpiarNombre(lf.slice(lf.search(/\S*\s*FISCAL[IÍ]A/))).slice(0,90);
  m=u.match(/(\d{1,2})\s+DE\s+([A-Z]+)\s+DE?L?\s*(?:ANO\s+)?(20\d{2})/);
  if(m)c.fofi=fechaLetras(m);
  m=u.match(/DELITOS?\s+(?:DE\s+|CONTRA\s+)?(.+?)(?=\s*(?:,|;|\.\s|\bEN\s+AGRAVIO\b|\bEN\s+PERJUICIO\b|\bAGRAVIAD|\bSE\s+DISPONE\b|\bA\s+FIN\b|\bPOR\s+EL\s+PLAZO\b|$))/);
  if(m)c.del=limpiarNombre(m[1]).slice(0,80);
  m=u.match(/(?:EN\s+AGRAVIO\s+DE(?:\s+LA|\s+EL|\s+DON|\s+DONA)?|AGRAVIAD[OA]S?\s*:)\s*([A-ZÑ ]+?)(?=\s*(?:,|;|\.|\bSE\b|\bPOR\b|\bA\s+FIN\b|\bDEBIENDO\b|\bINVESTIGAD|\bIMPUTAD|\bDENUNCIAD|\bPLAZO\b|$))/);
  if(m)c.agr=limpiarNombre(m[1]).slice(0,80);
  m=u.match(/(?:INVESTIGAD[OA]S?\s*:|IMPUTAD[OA]S?\s*:|DENUNCIAD[OA]S?\s*:|SEGUIDA\s+CONTRA|\bCONTRA\s+(?!LA\b|EL\b|LOS\b|LAS\b))\s*([A-ZÑ ]+?)(?=\s*(?:,|;|\.|\bPOR\b|\bEN\s+AGRAVIO\b|\bCOMO\b|\bAGRAVIAD|\bPLAZO\b|\bDELITO|$))/);
  if(m)c.imp=limpiarNombre(m[1]).slice(0,80);
  m=u.match(/PLAZO[^.]{0,50}?(\d{1,3})\s*\)?\s*DIAS(?:\s+(HABILES|NATURALES|CALENDARIO))?/)||u.match(/(\d{1,3})\s*\)\s*DIAS(?:\s+(HABILES|NATURALES|CALENDARIO))?/);
  if(m)c.plazo=m[1]+' DIAS'+(m[2]?' '+m[2]:'');
  m=u.match(/(?:VENCE|VENCIMIENTO)[^.]{0,20}?(\d{1,2})\s+DE\s+([A-Z]+)\s+DE?L?\s*(20\d{2})/);
  if(m)c.venc=fechaLetras(m);
  return c;
}
const CAMPOS_LOTE=[['ofi','Oficio'],['fofi','Fecha del oficio','date'],['cf','Carpeta fiscal'],['fis','Fiscalía / despacho'],['del','Delito'],['imp','Imputado'],['agr','Agraviado'],['plazo','Plazo'],['venc','Vencimiento','date']];
function vencSugerido(f,base){
  // En tu registro el vencimiento suele ser la entrega más el plazo. Con días hábiles no se calcula.
  const m=String(f.plazo||'').match(/^(\d+)\s*DIAS(\s+NATURALES|\s+CALENDARIO)?$/);
  return m&&isISO(base)?addDays(base,+m[1]):'';
}

// --- Subir oficios por lotes ---
const L={filas:[],elegidos:null,hecho:[],fecha:'',hora:''};
function elegidos(){
  if(!L.elegidos)L.elegidos=new Set();
  return store.efectivos.filter(e=>e.activo&&L.elegidos.has(e.id));
}
function duplicada(f){
  if(!f.cf&&!f.ofi)return null;
  const a=nrm(f.cf),b=nrm(f.ofi),k=numAnio(f.cf);
  return recs.find(r=>(a&&nrm(r.cf)===a)||(b&&nrm(r.ofi)===b))||(k&&recs.find(r=>pendiente(r)&&numAnio(r.cf)===k))||null;
}
// --- Ampliaciones: la disposición de prórroga se enlaza con la carpeta ya asignada; no lleva efectivo ni decreto ---
// También la que declara compleja la investigación: fija un plazo especial (por ejemplo, ocho meses).
const PRORROGA=/PRORROG|AMPLIA(?:R|CION)\s+(?:DEL?\s+|EL\s+)?PLAZO|DECLAR[A-Z]*\s+(?:QUE\s+DECLARA\s+)?COMPLEJ/;
const COMPLEJA=/DECLAR[A-Z]*\s+COMPLEJ/;
const addMeses=(iso,n)=>{const d=new Date(iso+'T00:00:00'),dia=d.getDate();d.setMonth(d.getMonth()+n);if(d.getDate()!==dia)d.setDate(0);return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())};
// "834-2026" del Excel y "4006018901-2026-834" del Ministerio Público son la misma carpeta.
const numAnio=t=>{t=String(t||'');const k=t.match(/(?<!\d)0*(\d{1,5})\s*-\s*(20\d{2})(?!\d)/);if(k)return k[1]+'-'+k[2];const m=t.match(/-(20\d{2})-0*(\d{1,5})(?!\d)/);return m?m[2]+'-'+m[1]:''};
const DIAS_LETRAS='PRIMERO UNO DOS TRES CUATRO CINCO SEIS SIETE OCHO NUEVE DIEZ ONCE DOCE TRECE CATORCE QUINCE DIECISEIS DIECISIETE DIECIOCHO DIECINUEVE VEINTE VEINTIUNO VEINTIDOS VEINTITRES VEINTICUATRO VEINTICINCO VEINTISEIS VEINTISIETE VEINTIOCHO VEINTINUEVE TREINTA'.split(' ');
function fechaEnLetras(u){
  // "Ventanilla; treinta de octubre del dos mil veintiséis"
  const m=u.match(/\b(PRIMERO|UNO|DOS|TRES|CUATRO|CINCO|SEIS|SIETE|OCHO|NUEVE|DIEZ|ONCE|DOCE|TRECE|CATORCE|QUINCE|DIECI\w+|VEINTI\w+|VEINTE|TREINTA(?:\s+Y\s+UNO)?)\s+DE\s+([A-Z]+)\s+DEL?\s+(?:ANO\s+)?DOS\s+MIL\s+VEINTI(CINCO|SEIS|SIETE)\b/);
  if(!m||!NMES[m[2]])return '';
  const d=m[1].startsWith('TREINTA Y')?31:m[1]==='PRIMERO'?1:DIAS_LETRAS.indexOf(m[1].replace(/\s+/g,''));
  return d>0?(2020+{CINCO:5,SEIS:6,SIETE:7}[m[3]])+'-'+pad(NMES[m[2]])+'-'+pad(d):'';
}
function datosProrroga(u){
  // Vale la parte resolutiva ("PRORROGAR ... por el plazo de CUARENTA (40) DÍAS adicionales"); si no, la última mención de la prórroga.
  // En la compleja: "FIJAR EN OCHO (08) MESES el plazo especial".
  const c=COMPLEJA.test(u)&&u.match(/FIJA[A-Z]*\s+EN\s+[A-Z]*\s*\(?\s*(\d{1,2})\s*\)?\s*(MESES|DIAS)/);
  const l=[...u.matchAll(/(?:PRORROG|AMPLI)[A-Z]*\b[^]{0,600}?\(?\s*(\d{1,3})\s*\)?\s*DIAS(\s+ADICIONALES)?/g)];
  const m=c?null:l.find(x=>x[2])||l[l.length-1];
  const d=u.match(/DISPOSICION\s+(?:FISCAL\s+)?N(?:RO)?\s*[°ºO.*'´`"~_]*\s*:?\s*(\d{1,3})/);
  return {dias:c?+c[1]:m?+m[1]:'',unidad:c?c[2]:'DIAS',compleja:!!c,desde:/A\s+PARTIR\s+DEL\s+VENCIMIENTO/.test(u)?'venc':c?'disp':'rec',ofi:d?'DISPOSICION FISCAL N° '+d[1].padStart(2,'0'):'',fofi:fechaEnLetras(u)};
}
function carpetasDeOficio(f){
  const k=numAnio(f.cf);if(!k)return [];
  let l=recs.filter(r=>pendiente(r)&&numAnio(r.cf)===k);
  // Varias carpetas comparten número (Familia y Delitos): desempata el apellido del investigado.
  if(l.length>1){const ap=nrm(f.imp).split(' ').filter(w=>w.length>3),x=l.filter(r=>ap.some(w=>nrm(r.imp).includes(w)));if(x.length)l=x}
  return l;
}
function calcularAmpliacion(f){
  const r=byId.get(f.dest),base=f.desde==='venc'?r?.venc:f.desde==='disp'?f.fofi:L.fecha;
  if(!f.vampManual)f.vamp=+f.dias&&isISO(base)?(f.unidad==='MESES'?addMeses(base,+f.dias):addDays(base,+f.dias)):'';
}
const esAmpliacion=f=>f.modo==='amp'&&f.dest!=='__nueva';
function filaAmpliacion(f,i){
  const cand=carpetasDeOficio(f),r=byId.get(f.dest);
  const lista=cand.length?cand:recs.filter(x=>pendiente(x)&&String(x.resp||'').trim()).sort((a,b)=>String(a.cf||'').localeCompare(String(b.cf||'')));
  const op='<option value="">— Escoge la carpeta —</option>'+lista.map(x=>'<option value="'+esc(x.id)+'"'+(x.id===f.dest?' selected':'')+'>'+esc((x.cf||x.ofi||x.id)+' · '+(x.resp||'sin efectivo')+' · vence '+corta(x.venc))+'</option>').join('')+'<option value="__nueva">No es ampliación: registrarla como carpeta nueva</option>';
  const req=v=>v?'':' <span class="req">· complétalo</span>';
  return '<div class="lote-fila" data-fila="'+i+'"><div class="row" style="justify-content:space-between"><div><b>'+esc(f.nombre)+'</b> <span class="tag t-blue">'+(f.compleja?'Declarada compleja':'Ampliación de plazo')+'</span> '+(f.ocr?'<span class="tag t-amber">Escaneado: revisa bien</span>':'<span class="tag t-green">Texto leído</span>')+'</div><button class="btn" data-quitar="'+i+'">Quitar</button></div>'+
   '<div class="fields"><label class="lote-ef">Carpeta ya registrada'+req(r)+'<select data-lf="dest">'+op+'</select></label>'+
   (r?'<p class="wide muted">A cargo de <b>'+esc(r.resp||'sin efectivo')+'</b> · vencía el '+esc(corta(r.venc))+'. Se le suma la ampliación: no cambia el efectivo ni lleva decreto nuevo.</p>':'')+
   '<label>Disposición u oficio<input data-lf="ofi" value="'+esc(f.ofi||'')+'"></label><label>Fecha de la disposición<input type="date" data-lf="fofi" value="'+esc(f.fofi||'')+'"></label>'+
   '<label>Plazo'+req(f.dias)+'<span class="row" style="flex-wrap:nowrap"><input type="number" min="1" data-lf="dias" value="'+esc(f.dias||'')+'" style="flex:1"><select data-lf="unidad" style="flex:1">'+['DIAS','MESES'].map(x=>'<option'+(x===(f.unidad||'DIAS')?' selected':'')+'>'+x+'</option>').join('')+'</select></span></label>'+
   '<label>Contados desde<select data-lf="desde">'+[['venc','el vencimiento anterior'],['disp','la fecha de la disposición'],['rec','la recepción ('+corta(L.fecha)+')']].map(([v,t])=>'<option value="'+v+'"'+(v===(f.desde||'rec')?' selected':'')+'>'+esc(t)+'</option>').join('')+'</select></label>'+
   '<label>Nuevo vencimiento'+req(f.vamp)+'<input type="date" data-lf="vamp" value="'+esc(f.vamp||'')+'"></label></div>'+
   '<details><summary class="muted">Ver lo que se leyó del archivo</summary><pre class="leido">'+esc(f.texto)+'</pre></details></div>';
}
function registrarAmpliacion(f){
  const r=byId.get(f.dest);
  // Mismo formato que la columna AMPLIACIONES del Excel; lo más nuevo primero.
  const plazo=f.dias+' '+(f.unidad||'DIAS');
  const nota='FECHA: '+fechaObs(L.fecha)+' '+(f.ofi||'DISPOSICION')+(isISO(f.fofi)?' DEL '+fechaObs(f.fofi):'')+', '+(f.compleja?'DECLARA COMPLEJA LA INVESTIGACION, PLAZO DE ':'DISPONE AMPLIAR POR ')+plazo+' VENCE EL '+fechaObs(f.vamp);
  setField(r.id,'amp',[nota,r.amp].filter(x=>String(x||'').trim()).join(' / '));
  setField(r.id,'pvig',plazo);
  setField(r.id,'venc',f.vamp);
  f.registrada=r.id;
}
function vLote(){
  if(!L.fecha){L.fecha=today();const d=new Date();L.hora=pad(d.getHours())+':'+pad(d.getMinutes())}
  const c=cargas();
  const activos=store.efectivos.filter(e=>e.activo).sort((a,b)=>c.get(a.id).p-c.get(b.id).p||a.nombre.localeCompare(b.nombre));
  const sel=L.elegidos||new Set();
  let h=cabecera('Mesa de Partes','Subir oficios por lotes','Los archivos se leen en esta computadora. Al registrar, se conserva el original dentro de su carpeta');
  h+='<div class="panel"><h2>1 · Escoge a los efectivos que recibirán carpetas</h2><p class="muted" style="margin-bottom:10px">Ordenados por menos carpetas pendientes. <button class="btn" id="efTodos">Marcar todos</button> <button class="btn" id="efNinguno">Quitar todos</button> <button class="btn" data-nav="efectivos">Editar lista</button></p><div class="ef-grid">'+
    activos.map(e=>{const k=c.get(e.id);return '<label class="ef-op"><input type="checkbox" data-elegir="'+esc(e.id)+'"'+(sel.has(e.id)?' checked':'')+'><span><b>'+esc(nombreEf(e))+'</b><small>'+k.p+' pendientes · '+k.v+' vencidas</small></span></label>'}).join('')+'</div></div>';
  h+='<div class="panel"><h2>2 · Sube los oficios</h2><div class="row" style="margin-bottom:12px"><label>Recibidos el<input type="date" id="loteFecha" value="'+esc(L.fecha)+'"></label><label>Hora<input type="time" id="loteHora" value="'+esc(L.hora)+'"></label><label>Primer N.° de decreto<input type="number" min="1" id="sigDec" value="'+esc(siguienteDecreto())+'"></label></div>'+
    '<label class="soltar" id="soltar"><input type="file" id="loteArchivos" accept="application/pdf,image/*" multiple><b>Haz clic o arrastra aquí los PDF o fotos de los oficios</b><span class="muted">Puedes elegir varios a la vez. Cada archivo debe ser un oficio.</span></label></div>';
  if(L.filas.length)h+='<div class="panel"><div class="row" style="justify-content:space-between;margin-bottom:10px"><h2 style="margin:0">3 · Revisa y asigna ('+L.filas.length+' oficios)</h2><div class="row"><button class="btn" id="repartir">Repartir entre los escogidos</button><button class="btn" id="loteVaciar">Vaciar lista</button><button class="btn main" id="loteRegistrar">Registrar y generar decretos</button></div></div><div id="loteAviso"></div><div id="loteFilas">'+L.filas.map(filaHTML).join('')+'</div></div>';
  if(L.ampliadas?.length)h+='<div class="panel"><h2>Ampliaciones registradas ('+L.ampliadas.length+')</h2><div class="scroll"><table><thead><tr><th>Carpeta</th><th>Efectivo</th><th>Nuevo vencimiento</th><th>Ampliación</th><th></th></tr></thead><tbody>'+
    L.ampliadas.map(i=>{const r=byId.get(i);return r?'<tr><td><span class="case">'+esc(r.cf||r.id)+'</span></td><td>'+esc(r.resp||'')+'</td><td>'+esc(corta(r.venc))+'</td><td>'+esc(String(r.amp||'').split(' / ')[0])+'</td><td><button class="btn" data-id="'+esc(i)+'">Abrir</button></td></tr>':''}).join('')+'</tbody></table></div><p class="muted" style="margin-top:10px">La disposición quedó guardada en los documentos de cada carpeta. Falta copiar la ampliación al Excel (Guía → Falta copiar al Excel).</p></div>';
  if(L.hecho.length)h+=resultadoHTML();
  $('app').innerHTML=h;
  avisoLote();
}
function filaHTML(f,i){
  const opciones='<option value="">— Escoge efectivo —</option>'+store.efectivos.filter(e=>e.activo).sort((a,b)=>a.nombre.localeCompare(b.nombre)).map(e=>'<option value="'+esc(e.id)+'"'+(f.ef===e.id?' selected':'')+'>'+esc(nombreEf(e))+'</option>').join('');
  if(f.estado!=='listo')return '<div class="lote-fila"><b>'+esc(f.nombre)+'</b> <span class="tag '+(f.estado==='error'?'t-red':'t-blue')+'">'+esc(f.aviso)+'</span>'+(f.estado==='error'?' <button class="btn" data-quitar="'+i+'">Quitar</button>':'')+'</div>';
  if(esAmpliacion(f))return filaAmpliacion(f,i);
  const dup=duplicada(f);
  const falta=['ofi','cf','fis','plazo','venc'].filter(k=>!f[k]);
  return '<div class="lote-fila" data-fila="'+i+'"><div class="row" style="justify-content:space-between"><div><b>'+esc(f.nombre)+'</b> '+(f.ocr?'<span class="tag t-amber">Escaneado: revisa bien</span>':'<span class="tag t-green">Texto leído</span>')+(dup?' <span class="tag t-red">Ya existe: '+esc(dup.cf||dup.id)+'</span>':'')+'</div><button class="btn" data-quitar="'+i+'">Quitar</button></div>'+
   '<div class="fields"><label class="lote-ef">Efectivo a cargo<select data-lf="ef">'+opciones+'</select></label>'+CAMPOS_LOTE.map(([k,t,tipo])=>'<label>'+esc(t)+(falta.includes(k)?' <span class="req">· no se leyó</span>':'')+'<input type="'+(tipo||'text')+'" data-lf="'+k+'" value="'+esc(f[k]||'')+'"></label>').join('')+'</div>'+
   '<details><summary class="muted">Ver lo que se leyó del archivo</summary><pre class="leido">'+esc(f.texto)+'</pre></details></div>';
}
function repartir(){
  const lista=elegidos();
  if(!lista.length)return avisoLote('Primero escoge al menos un efectivo en el paso 1.');
  const c=cargas(),carga=new Map(lista.map(e=>[e.id,c.get(e.id).p]));
  for(const f of L.filas){
    if(f.estado!=='listo'||f.ef)continue;
    const e=[...lista].sort((a,b)=>carga.get(a.id)-carga.get(b.id))[0];
    f.ef=e.id;carga.set(e.id,carga.get(e.id)+1);
  }
  vLote();
}
function avisoLote(msg){const el=$('loteAviso');if(el)el.innerHTML=msg?'<p class="aviso-error">'+esc(msg)+'</p>':''}
async function agregarArchivos(files){
  const nuevos=[...files].filter(f=>f.type==='application/pdf'||f.type.startsWith('image/')||/\.pdf$/i.test(f.name));
  if(!nuevos.length)return;
  const filas=nuevos.map(file=>({file,nombre:file.name,estado:'leyendo',aviso:'En espera…'}));
  L.filas.push(...filas);
  vLote();
  // Uno por uno: el OCR ocupa mucha memoria y así la página no se traba.
  for(const f of filas){
    const refrescar=m=>{f.aviso=m;const box=$('loteFilas');if(box&&S.view==='lote')box.innerHTML=L.filas.map(filaHTML).join('')};
    refrescar('Leyendo…');
    try{
      const {texto,ocr:esOcr}=await textoDeArchivo(f.file,refrescar);
      Object.assign(f,extraerCampos(texto),{texto,ocr:esOcr,estado:'listo',aviso:''});
      const u=nrm(texto);
      if(PRORROGA.test(u)){
        const l=carpetasDeOficio(f),p=datosProrroga(u);
        Object.assign(f,{modo:'amp',dest:l.length===1?l[0].id:'',dias:p.dias,unidad:p.unidad,compleja:p.compleja,desde:p.desde},p.ofi?{ofi:p.ofi}:{},p.fofi?{fofi:p.fofi}:{});
        calcularAmpliacion(f);
      }
      if(!f.venc)f.venc=vencSugerido(f,L.fecha);
      if(!String(texto).trim())Object.assign(f,{estado:'error',aviso:'No se pudo leer texto en este archivo'});
    }catch(e){
      console.error(e);
      Object.assign(f,{estado:'error',aviso:e.message&&e.message.includes('recursos/')?e.message:'No se pudo leer este archivo'});
    }
    // El archivo se conserva: al registrar se guarda como documento de la carpeta.
    if(f.estado==='error')delete f.file;
    if(S.view==='lote')vLote();
  }
}
async function registrarLote(){
  if(L.registrando)return;
  const listos=L.filas.filter(f=>f.estado==='listo');
  if(!listos.length)return avisoLote('No hay oficios listos para registrar.');
  const amps=listos.filter(esAmpliacion),nuevas=listos.filter(f=>!esAmpliacion(f));
  const ampFalta=amps.filter(f=>!f.registrada&&(!byId.get(f.dest)||!+f.dias||!isISO(f.vamp))).length;
  if(ampFalta)return avisoLote(ampFalta+' ampliación(es) sin carpeta, días o nuevo vencimiento. Complétalas.');
  const sinEf=nuevas.filter(f=>!f.ef).length;
  const sinCarpeta=nuevas.filter(f=>!f.cf&&!f.ofi).length;
  if(sinCarpeta)return avisoLote(sinCarpeta+' oficio(s) no tienen ni carpeta ni número de oficio. Complétalos.');
  const dups=nuevas.filter(f=>!f.registrada&&duplicada(f));
  if(dups.length&&!confirm(dups.length+' oficio(s) parecen estar ya registrados. ¿Registrarlos de todos modos?'))return;
  if(sinEf&&!confirm(sinEf+' oficio(s) no tienen efectivo: se registrarán sin decreto y quedarán en "Por asignar". ¿Continuar?'))return;
  const hechos=[];
  L.registrando=true;
  try{
  await guardarAhora();
  for(const f of amps)if(!f.registrada){registrarAmpliacion(f);L.ampliadas=[...new Set([f.registrada,...(L.ampliadas||[])])]}
  for(const f of nuevas){
    if(f.registrada&&byId.has(f.registrada))continue;
    const e=store.efectivos.find(x=>x.id===f.ef);
    let n=1,id;do{id='MP-'+String(n++).padStart(6,'0')}while(byId.has(id));
    const r={id,rem:'NO',sec:'',_mod:new Date().toISOString(),rec:L.fecha,hrec:L.hora,...(e?{ent:L.fecha,fdec:L.fecha,dec:tomarDecreto(),resp:nombreEf(e),grado:e.grado,cip:e.cip||'',cargo:e.cargo||''}:{})};
    for(const [k] of CAMPOS_LOTE)if(f[k])r[k]=f[k];
    if(!r.venc)r.venc=vencSugerido(f,L.fecha);
    r.obs='';
    store.nuevos.push(r);byId.set(id,r);recs.push(r);
    f.registrada=id;
    if(e)hechos.push(id);
  }
  L.hecho=[...new Set(hechos.concat(L.hecho))];
  save();await guardarAhora();
  const errores=[];
  for(const f of listos){
    try{
      if(!f.originalGuardado){await guardarDocumentoCarpeta(f.registrada,esAmpliacion(f)?'ampliacion':'fiscal',f.file);f.originalGuardado=true}
    }catch(e){errores.push(f.nombre+': '+e.message)}
  }
  L.filas=L.filas.filter(f=>!f.originalGuardado);
  render();
  if(errores.length)avisoLote('Las carpetas ya están registradas; falta conservar estos archivos originales. Reintentar no crea otra carpeta. '+errores.join(' / '));
  else window.scrollTo(0,document.body.scrollHeight);
  }catch(e){avisoLote('No se pudo completar el registro: '+e.message+'. Conserva esta pestaña para reintentar.')}
  finally{L.registrando=false}
}
function resultadoHTML(){
  return '<div class="panel" id="loteHecho"><div class="row" style="justify-content:space-between;margin-bottom:10px"><h2 style="margin:0">4 · Decretos listos ('+L.hecho.length+')</h2><button class="btn main" id="decretosZip">Descargar todos (ZIP)</button></div><div class="scroll"><table><thead><tr><th>Decreto</th><th>Carpeta</th><th>Efectivo</th><th>Vencimiento</th><th></th></tr></thead><tbody>'+
   L.hecho.map(i=>{const r=byId.get(i);return r?'<tr><td>'+esc(r.dec)+'</td><td><span class="case">'+esc(r.cf||r.ofi)+'</span></td><td>'+esc(r.resp)+'</td><td>'+esc(corta(r.venc))+'</td><td style="white-space:nowrap"><button class="btn" data-word="decreto" data-wid="'+esc(i)+'">Descargar Word</button> <button class="btn" data-doc="decreto" data-docid="'+esc(i)+'">Ver</button></td></tr>':''}).join('')+'</tbody></table></div><p class="muted" style="margin-top:10px">Revísalos antes de la firma. Las carpetas ya están en Carpetas y se guardan en este navegador.</p></div>';
}

// --- Números de decreto: correlativos y sin repetir, aunque alguno se haya escrito a mano ---
const numeroDec=v=>{const m=String(v??'').trim().match(/^\d+/);return m?+m[0]:0};
function siguienteDecreto(){return Math.max(+store.cfg.sigDec||1,...recs.concat(ADIC).map(r=>numeroDec(r.dec)+1))}
function tomarDecreto(){const n=siguienteDecreto();store.cfg.sigDec=n+1;return String(n)}
function numerar(r,fecha){
  if(numeroDec(r.dec))return;
  setField(r.id,'dec',tomarDecreto());
  if(!r.fdec)setField(r.id,'fdec',fecha||r.ent||today());
}
function avisarRepetido(id,v){
  const n=numeroDec(v);if(!n)return;
  const otra=recs.concat(ADIC).find(r=>r.id!==id&&numeroDec(r.dec)===n);
  if(otra)alert('El N.° de decreto '+n+' ya lo tiene '+(otra.cf||otra.id)+'. Usa otro para no repetirlo. El siguiente libre es el '+siguienteDecreto()+'.');
}

// --- Ruta del trámite: cada etapa de la carpeta con su estado, como en Moral y Disciplina ---
const tieneMemo=r=>!!(String(r.mnum||'').trim()||Object.values(r.memos||{}).some(v=>String(v||'').trim()));
const conDecretoPropio=r=>DECRETO_INDICADO.includes(r.id)||!!store.edits[r.id]?.resp||!r.hoja;
const decretoHecho=r=>!!(r.decbaj||r.adjDec||numeroDec(r.dec));
const fechaDescargo=r=>{
  const m=nrm(r.obs).match(/DESC\w*\s*(?:EL)?\s*(\d{1,2})\s*([A-Z]{3})\s*(\d{2})\b/);
  const mes=m?'ENE FEB MAR ABR MAY JUN JUL AGO SET OCT NOV DIC'.split(' ').indexOf(m[2].replace('SEP','SET')):-1;
  return mes>=0?pad(+m[1])+'/'+pad(mes+1)+'/20'+m[3]:'';
};
function etapaActual(r){
  if(r.rem==='SÍ')return 'Descargada';
  if(r.rem==='DEVUELTA/ARCHIVADA')return 'Devuelta o archivada';
  if(!String(r.resp||'').trim())return 'Por asignar';
  if(conDecretoPropio(r)&&!r.decbaj)return 'Decreto por descargar';
  if(vigencia(r)==='VENCIDA')return tieneMemo(r)&&!vencioDeNuevo(r)?'Vencida, con memorándum':'Vencida, falta memorándum';
  if(String(r.doc||'').trim()||r.adjInf)return 'Informe formulado, falta descargo';
  if(informePeriodico(r))return 'Informe periódico';
  return 'En investigación';
}
const ETAPAS={'Por asignar':'t-amber','Decreto por descargar':'t-amber','En investigación':'t-green','Informe periódico':'t-blue','Vencida, falta memorándum':'t-red','Vencida, con memorándum':'t-red','Informe formulado, falta descargo':'t-blue','Descargada':'t-gray','Devuelta o archivada':'t-gray'};
const tagEtapa=e=>'<span class="tag '+(ETAPAS[e]||'t-gray')+'">'+esc(e)+'</span>';
function etapasDe(r){
  const v=vigencia(r),cerrada=r.rem==='SÍ'||r.rem==='DEVUELTA/ARCHIVADA',asignada=!!String(r.resp||'').trim();
  const l=[{t:'Recepción',f:corta(r.rec),e:r.rec?'completo':'pendiente'}];
  l.push({t:'Asignada a efectivo',f:asignada?[r.resp,corta(r.ent)].filter(Boolean).join(' · '):'',e:asignada?'completo':cerrada?'nd':'pendiente',n:'Sin dato'});
  // Los decretos anteriores a esta página no se registraron aquí: no se muestran como pendientes.
  l.push(decretoHecho(r)?{t:'Decreto',f:[numeroDec(r.dec)?'N.° '+r.dec:'',corta(r.fdec),r.adjDec?'firmado':''].filter(Boolean).join(' · '),e:r.decbaj||!conDecretoPropio(r)?'completo':'pendiente'}:conDecretoPropio(r)?{t:'Decreto',e:asignada?'pendiente':'nd',n:'Falta efectivo'}:{t:'Decreto',e:'nd',n:'Anterior'});
  if(String(r.aper||'').trim())l.push({t:'Apersonamiento',f:'ver el campo Apersonamientos',e:'completo'});
  if(ampliada(r))l.push({t:'Ampliación',e:'completo'});
  const plazo={t:informePeriodico(r)?'Investigación (informe periódico)':'Plazo de investigación',f:isISO(r.venc||'')?'vence '+corta(r.venc):''};
  plazo.e=cerrada?'completo':v==='VENCIDA'?'vencido':asignada?'pendiente':'nd';
  if(!asignada&&!cerrada)plazo.n='Falta efectivo';
  l.push(plazo);
  if(v==='VENCIDA'||tieneMemo(r)){
    const hecho=tieneMemo(r)&&!vencioDeNuevo(r);
    l.push({t:'Memorándum de recordatorio',f:hecho?[r.mnum?'N.° '+r.mnum:'',corta(r.mfec)].filter(Boolean).join(' · '):vencioDeNuevo(r)?'venció de nuevo':'',e:hecho?'completo':'vencido',v:'Falta'});
  }
  const informe=String(r.doc||'').trim();
  l.push({t:'Informe policial',f:[informe,r.adjInf?'informe subido':''].filter(Boolean).join(' · '),e:informe||r.adjInf||r.rem==='SÍ'?'completo':cerrada?'nd':asignada?'pendiente':'nd',n:cerrada?'No aplica':'Falta efectivo'});
  l.push(r.rem==='DEVUELTA/ARCHIVADA'?{t:'Devuelta o archivada',e:'completo'}:{t:'Descargo a la Fiscalía',f:[fechaDescargo(r),r.adjCar?'cargo subido':''].filter(Boolean).join(' · '),e:r.rem==='SÍ'?'completo':informe?'pendiente':'nd',n:'Falta informe'});
  return l;
}
function rutaHTML(r){
  const LABEL={completo:'Completo',pendiente:'Pendiente',vencido:'Vencido',nd:'No disponible'},ICON={completo:'✓',pendiente:'•',vencido:'!',nd:'–'};
  return '<div class="ruta"><h3>Ruta del trámite</h3><ol class="tramite-etapas">'+etapasDe(r).map(x=>'<li class="tramite-etapa te-'+x.e+'"><span class="te-icon">'+ICON[x.e]+'</span><span class="te-nombre">'+esc(x.t)+(x.f?' <span class="muted">— '+esc(x.f)+'</span>':'')+'</span><span class="te-estado">'+esc(x.e==='nd'?x.n||LABEL.nd:x.e==='vencido'?x.v||LABEL.vencido:LABEL[x.e])+'</span></li>').join('')+'</ol></div>';
}

// --- Documentos firmados: el archivo queda en IndexedDB de este navegador; en la carpeta, solo su nombre y fecha ---
const ADJ={dec:{t:'Decreto firmado',k:'adjDec'},inf:{t:'Informe policial',k:'adjInf'},car:{t:'Cargo de remisión a la Fiscalía',k:'adjCar'}};
const bdAdj=()=>new Promise((ok,mal)=>{
  const q=indexedDB.open('carpetas_adjuntos',1);
  q.onupgradeneeded=()=>q.result.createObjectStore('archivos');
  q.onsuccess=()=>ok(q.result);q.onerror=()=>mal(q.error);
});
async function opAdj(modo,fn){
  const bd=await bdAdj();
  return new Promise((ok,mal)=>{
    const tx=bd.transaction('archivos',modo),q=fn(tx.objectStore('archivos'));
    tx.oncomplete=()=>{bd.close();ok(q.result)};
    tx.onerror=tx.onabort=()=>{bd.close();mal(tx.error||new Error('No se pudo guardar el archivo.'))};
  });
}
const claveAdj=(id,tipo)=>id+'|'+tipo;
// Con la base de datos de esta PC los archivos van al servidor; abierta como archivo, a IndexedDB de este Chrome.
const ESCRIBIR={'X-Carpetas':'1'};
async function peticionDocumento(url,opciones={},leer=r=>r,limite=90000){
  const control=new AbortController(),timer=setTimeout(()=>control.abort(),limite);
  try{return await leer(await fetch(url,{...opciones,signal:control.signal}))}
  catch(e){if(e.name==='AbortError')throw Error('La conexión tardó demasiado. Revisa si el archivo quedó guardado antes de reintentar.');throw e}
  finally{clearTimeout(timer)}
}
async function adjPoner(clave,f){
  if(!SRV)return opAdj('readwrite',s=>s.put({nombre:f.name,tipo:f.type,archivo:f},clave));
  return peticionDocumento('api/adjunto?k='+encodeURIComponent(clave)+'&n='+encodeURIComponent(f.name)+'&t='+encodeURIComponent(f.type),{method:'PUT',headers:ESCRIBIR,body:f},r=>{if(!r.ok||r.redirected)throw new Error('No se pudo guardar el archivo en la base de datos.')});
}
async function adjLeer(clave){
  if(!SRV)return opAdj('readonly',s=>s.get(clave));
  return peticionDocumento('api/adjunto?k='+encodeURIComponent(clave),{},async r=>{
  if(r.status===404)return null;
  if(!r.ok||r.redirected)throw new Error('No se pudo leer el documento.');
  const b=await r.blob();
  return {nombre:decodeURIComponent(r.headers.get('X-Nombre')||''),tipo:b.type,archivo:b};
  });
}
async function adjQuitar(clave){
  if(!SRV)return opAdj('readwrite',s=>s.delete(clave));
  return peticionDocumento('api/adjunto?k='+encodeURIComponent(clave),{method:'DELETE',headers:ESCRIBIR},r=>{if(!r.ok||r.redirected)throw new Error('No se pudo quitar el documento; se mantiene su registro.')});
}
async function adjListar(){
  if(!SRV)return opAdj('readonly',s=>s.getAllKeys());
  return (await inventarioArchivos()).map(x=>x.clave);
}
function fechaObs(iso){return iso.slice(8)+'ENE FEB MAR ABR MAY JUN JUL AGO SET OCT NOV DIC'.split(' ')[+iso.slice(5,7)-1]+iso.slice(2,4)}
function filaAdj(r,tipo){
  const a=ADJ[tipo],m=r[a.k];
  if(m)return '<div class="adj-fila"><div><b>'+esc(a.t)+'</b> <span class="tag t-green">Subido</span><br><span class="muted">'+esc(m.n)+' · subido el '+esc(fechaHora(m.f))+(m.fecha?' · sello del '+esc(corta(m.fecha)):'')+(m.fechaDocumento?' · oficio del '+esc(corta(m.fechaDocumento)):'')+'</span></div><div class="row"><button class="btn" data-adjver="'+tipo+'">Ver</button><button class="btn" data-adjdel="'+tipo+'">Quitar</button></div></div>';
  return '<div class="adj-fila"><div class="fields"><label class="wide">'+esc(a.t)+'<input type="file" id="adjF_'+tipo+'" accept="application/pdf,image/*"></label>'+
    (tipo==='car'?'<label>Fecha del sello de la Fiscalía<input type="date" id="adjFecha" max="'+esc(today())+'"></label><label>Documento formulado (opcional)<input id="adjDoc" value="'+esc(r.doc||'')+'"></label>':'')+
    '</div><button class="btn main" data-adjsub="'+tipo+'">Guardar</button></div>';
}
function adjuntos(){
  const el=$('adjuntos'),r=byId.get(S.cur);if(!el||!r)return;
  el.innerHTML='<div class="ruta"><p class="muted" style="margin:4px 0 8px">'+(SRV?'Se guardan en la base de datos de esta PC.':'Se guardan solo en este navegador.')+' Conserva también tus originales.</p><div id="adjAviso"></div><div class="adj-fila"><div class="fields"><label>Tipo de documento<select id="docCarpetaTipo">'+Object.entries(TIPOS_DOC_CARPETA).map(([k,v])=>'<option value="'+k+'">'+esc(v)+'</option>').join('')+'</select></label><label>PDF o fotos (puedes elegir varios)<input type="file" id="docCarpetaArchivos" multiple accept="application/pdf,image/*"></label></div><button class="btn main" id="agregarDocCarpeta">Guardar documentos</button></div><h4 style="margin:16px 0 8px">Documentos con seguimiento</h4>'+filaAdj(r,'dec')+filaAdj(r,'inf')+filaAdj(r,'car')+'</div>';
}
function avisoAdj(m){const el=$('adjAviso');if(el)el.innerHTML='<p class="aviso-error">'+esc(m)+'</p>'}
// Guarda el archivo y marca la carpeta; sirve para un documento o para un lote.
async function guardarAdj(r,tipo,f,fecha,doc,datos={}){
  if(!r||!Object.hasOwn(ADJ,tipo)||!f||!archivoValido(f)||!f.size||f.size>25*1024*1024)throw Error('Elige un PDF o foto de hasta 25 MB.');
  if(tipo==='car'&&(!isISO(fecha)||fecha>today()))throw Error('Completa una fecha válida del sello de la Fiscalía.');
  await guardarAhora();
  await adjPoner(claveAdj(r.id,tipo),f);
  const meta={n:f.name,f:new Date().toISOString(),...(Number.isInteger(datos.envioId)?{envioId:datos.envioId}:{})};
  if(tipo==='inf'){setField(r.id,'adjInf',meta);if(doc)setField(r.id,'doc',doc)}
  else if(tipo==='dec'){
    setField(r.id,'adjDec',meta);setField(r.id,'decf','SÍ');
    if(!r.decbaj)setField(r.id,'decbaj',meta.f);
  }else{
    setField(r.id,'adjCar',{...meta,fecha,...(isISO(datos.fechaDocumento)?{fechaDocumento:datos.fechaDocumento}:{}),obsAnt:r.obs||'',remAnt:r.rem||'',docAnt:r.doc||''});
    if(doc)setField(r.id,'doc',doc);
    if(r.rem!=='SÍ'){
      const ant=String(r.obs||'').trim();
      setField(r.id,'obs','DESCARGADO EL '+fechaObs(fecha)+(ant?' / '+ant:''));
      setField(r.id,'rem','SÍ');
    }
  }
  await guardarAhora();
}
const archivoValido=f=>f.type==='application/pdf'||f.type.startsWith('image/');
async function subirAdj(tipo,boton){
  const r=byId.get(S.cur),f=$('adjF_'+tipo)?.files?.[0];
  if(!f)return avisoAdj('Elige primero el archivo.');
  if(!archivoValido(f))return avisoAdj('El archivo debe ser un PDF o una foto.');
  const fecha=tipo==='car'?$('adjFecha').value:'';
  if(tipo==='car'&&!isISO(fecha))return avisoAdj('Escribe la fecha del sello de la Fiscalía.');
  if(boton?.disabled)return;if(boton)boton.disabled=true;
  try{if(await adjLeer(claveAdj(r.id,tipo)))throw Error('Ya hay un archivo guardado para este documento. Consúltalo en Archivos antes de reemplazarlo.');await guardarAdj(r,tipo,f,fecha,tipo==='car'?$('adjDoc').value.trim():'')}
  catch(e){console.error(e);return avisoAdj(e.message||'No se pudo guardar el archivo.')}
  finally{if(boton)boton.disabled=false}
  render();
}

// --- Subir firmados por lote: reconoce la carpeta por el nombre del archivo o su texto; nada se guarda sin revisar ---
const LF={tipo:'auto',filas:[],fecha:'',hecho:'',auto:true,separar:true,ocupado:false};
window.addEventListener('beforeunload',e=>{if(LF.ocupado||LF.filas.length||L.registrando||L.filas.length){e.preventDefault();e.returnValue=''}});
function destinosMemo(){
  const lista=[];
  for(const r of recs){
    const personas=efectivosDe(r),entradas=compartida(r)?Object.entries(r.memos||{}):[[personas[0]?.id||'',r.mnum]];
    for(const [ef,num] of entradas){
      if(!numeroDec(num))continue;
      const anio=isISO(r.mfec)?r.mfec.slice(0,4):'',e=store.efectivos.find(x=>x.id===ef);
      lista.push({...r,id:[r.id,'memo',String(numeroDec(num)),anio,ef].join('::'),_rid:r.id,_num:String(numeroDec(num)),_anio:anio,_ef:ef,resp:e?nombreEf(e):r.resp});
    }
  }
  return lista;
}
function reconocerDocumentoLF(texto,tipoElegido=LF.tipo,textoCabecera=''){
  if(tipoElegido==='auto'){const ids=['mem','dec','car'].map(t=>reconocerDocumentoLF(texto,t,textoCabecera)).filter(Boolean);return ids.length===1?ids[0]:''}
  if(tipoElegido==='car')return reconocerCargoFiscal(texto);
  const s=nrm(texto).replace(/_/g,' ').replace(/[–—−]/g,'-'),tipo=tipoElegido==='mem'?'MEMORAND[UO05]M?':'DECRETO';
  const cabecera=(textoCabecera?nrm(textoCabecera).replace(/_/g,' ').replace(/[–—−]/g,'-'):s).slice(0,900);
  if(!new RegExp('\\b'+tipo+'\\b').test(cabecera))return '';
  const re=new RegExp('\\b'+tipo+'\\s*[*:.]?\\s*(?:N[.\\s°ºO0]*|NUMERO\\s*)?0*(\\d{1,6})\\s*[-/., ]\\s*(20\\d{2})\\b','g');
  const hallados=[...cabecera.matchAll(re)].map(m=>[String(+m[1]),m[2]]);
  // En escaneos, el título y su número pueden quedar en bloques separados.
  // Solo se admite el número que está unido a las siglas institucionales.
  for(const m of cabecera.matchAll(/(?<!\d)0*(\d{1,6})\s*[-/.,]\s*(20\d{2})\s*[-/]\s*(?:C[O0]M[O0]P[A-Z0-9]{1,8}|PNP)\b/g))hallados.push([String(+m[1]),m[2]]);
  const pares=[...new Set(hallados.map(m=>m.join('|')))];
  if(pares.length!==1)return '';
  const [num,anio]=pares[0].split('|');
  let lista=candidatosLF(tipoElegido).filter(r=>String(tipoElegido==='mem'?r._num:numeroDec(r.dec))===num&&(tipoElegido==='mem'?r._anio:(isISO(r.fdec)?r.fdec.slice(0,4):''))===anio);
  // Un dato contradictorio de carpeta impide guardar por coincidencia del número de documento.
  const cf=[...s.matchAll(/\b(?:C\.?\s*F\.?|CARPETA(?:\s+FISCAL)?)\s*(?:N[-.\s°ºO0*'"”“´`:]*\s*)?\s*:?\s*(\d{1,14}(?:\s*[-/.,]\s*\d{1,14}){1,4})/g)].map(m=>numAnio(m[1].replace(/\s/g,'').replace(/[/.,]/g,'-'))).filter(Boolean);
  if(/\bCARPETA\s+FISCAL\s+N/.test(s)&&!cf.length)return '';
  if(cf.length)lista=lista.filter(r=>cf.every(k=>numAnio(r.cf)===k));
  const destinatario=s.match(/\bSE[ÑN]OR\s*:?\s*([^]{0,250}?)(?=\bREF\b|\bREFERENCIA\b|ME DIRIJO)/)?.[1];
  if(destinatario){const personas=store.efectivos.filter(e=>nrm(e.nombre).split(' ').filter(w=>w.length>3&&destinatario.includes(w)).length>=2);if(personas.length)lista=lista.filter(r=>personas.some(e=>r._ef===e.id||efectivosDe(r).some(x=>x.id===e.id)))}
  const cips=[...s.matchAll(/\bCIP\s*[:.\-]?\s*(\d{5,9})\b/g)].map(m=>m[1]);
  if(cips.length)lista=lista.filter(r=>{const e=store.efectivos.find(e=>e.id===r._ef)||efectivoDe(r);return e&&cips.includes(String(e.cip||''))});
  return lista.length===1?lista[0].id:'';
}
const numCarpeta=r=>{
  const t=String(r.cf||r.ofi||'');
  const m=t.match(/-20\d{2}-0*(\d{1,5})(?:-\d)?\b/)||t.match(/0*(\d{1,5})\s*-\s*20\d{2}/);
  return m?m[1]:'';
};
function referenciasFiscales(texto){
  return [...nrm(texto).replace(/[–—−]/g,'-').matchAll(/\b(?:CARPETA(?:\s+FISCAL)?|C\.?\s*F\.?)\s*(?:N[-.\s°ºO0*'"”“´`:]*\s*)?\s*:?\s*(\d{1,14}(?:\s*[-/.,]\s*\d{1,14}){1,4})/g)].map(m=>numAnio(m[1].replace(/\s/g,'').replace(/[/.,]/g,'-'))).filter(Boolean);
}
function reconocerCargoFiscal(texto){
  const s=nrm(texto),cf=[...new Set(referenciasFiscales(s))];
  if(!/\bCARG\s*O\b/.test(s.slice(0,900))||!/\bOFICIO\b/.test(s)||!/FISCAL|MINISTERIO PUBLICO/.test(s)||cf.length!==1)return '';
  let lista=candidatosLF('car').filter(r=>numAnio(r.cf)===cf[0]);
  const porPersonas=carpetasPorPersonasCargo(s);
  if(porPersonas.length)lista=lista.filter(r=>porPersonas.some(x=>x.id===r._rid));
  if(lista.length>1){const coinciden=lista.filter(r=>[r.imp,r.agr].some(nombre=>nrm(nombre).split(' ').filter(w=>w.length>3&&s.includes(w)).length>=2));if(coinciden.length)lista=coinciden}
  return lista.length===1?lista[0].id:'';
}
function carpetasPorPersonasCargo(texto){
  const s=nrm(texto);
  return recs.filter(r=>[r.imp,r.agr].every(nombre=>nrm(nombre).split(' ').filter(w=>w.length>3&&s.includes(w)).length>=2));
}
function avisoCargoFiscal(texto){
  const cf=[...new Set(referenciasFiscales(texto))],personas=carpetasPorPersonasCargo(texto);
  return cf.length===1&&personas.length===1&&numAnio(personas[0].cf)!==cf[0]?'El oficio cita CF '+cf[0]+', pero las personas coinciden con '+personas[0].cf+'. Revisa esta diferencia antes de elegir el destino.':'';
}
function fechasTextoCargo(texto){
  const s=nrm(texto).replace(/[–—−]/g,'-'),fechas=[];
  const agregar=(d,m,a)=>{const v=String(a)+'-'+pad(+m)+'-'+pad(+d);if(isISO(v)&&v<=today())fechas.push(v)};
  for(const m of s.matchAll(/\b(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(20\d{2})\b/g))agregar(m[1],m[2],m[3]);
  for(const m of s.matchAll(/\b(\d{1,2})\s*(?:DE\s+)?([A-Z0]{3,12})\.?\s*(?:DEL?\s+)?(2[0O]2[0-9O])\b/g)){
    const mes=m[2].replace(/0/g,'O').replace(/^NUV$/,'NOV'),n=NMES[mes]||({ENE:1,FEB:2,MAR:3,ABR:4,MAY:5,JUN:6,JUL:7,AGO:8,SET:9,SEP:9,OCT:10,NOV:11,DIC:12})[mes];if(n)agregar(m[1],n,m[3].replace(/O/g,'0'));
  }
  return [...new Set(fechas)];
}
function datosCargoLeido(texto,textoSello=''){
  const u=nrm(texto).replace(/[–—−]/g,'-'),fechaDocumento=fechasTextoCargo(u.match(/VENTANILLA\s*[,;:]?\s*([^]{0,65})/)?.[1]||'')[0]||'';
  const sello=nrm(textoSello),fechas=/RECIBIDO|MINISTERIO\s+PUBLICO/.test(sello)?fechasTextoCargo(sello):[];
  const informes=[...new Set([...u.matchAll(/\bINFORME\s*(?:N[-.\s°ºO0*'"”“´`:]*\s*)?0*(\d{1,6})\s*[-/]\s*(20\d{2})/g)].map(m=>Number(m[1])+'-'+m[2]))];
  return {fechaDocumento,fechaSugerida:fechas.length===1?fechas[0]:'',documento:informes.length===1?'INFORME N.° '+informes[0]:''};
}
function tintaRojaSello(origen){
  const w=origen.width,h=origen.height,ctx=origen.getContext('2d'),pix=ctx.getImageData(0,0,w,h),d=pix.data;
  let x0=w,y0=h,x1=0,y1=0,n=0;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=(y*w+x)*4,r=d[i],g=d[i+1],b=d[i+2];
    const rojo=x>w*.03&&x<w*.97&&y<h*.9&&r<235&&r-g>12&&r-b>12&&r>g*1.15&&r>b*1.12;
    d[i]=d[i+1]=d[i+2]=rojo?0:255;d[i+3]=255;
    if(rojo){n++;x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y)}
  }
  if(n<50||x1<=x0||y1<=y0)return null;
  const limpia=document.createElement('canvas');limpia.width=w;limpia.height=h;limpia.getContext('2d').putImageData(pix,0,0);
  const recorte=document.createElement('canvas');recorte.width=x1-x0+33;recorte.height=y1-y0+33;
  const c=recorte.getContext('2d');c.fillStyle='white';c.fillRect(0,0,recorte.width,recorte.height);c.drawImage(limpia,x0,y0,x1-x0+1,y1-y0+1,16,16,x1-x0+1,y1-y0+1);limpia.width=limpia.height=0;
  return recorte;
}
const candidatosLF=(tipo=LF.tipo)=>(tipo==='auto'?candidatosLF('mem').concat(candidatosLF('dec'),candidatosLF('car')):tipo==='mem'?destinosMemo().map(r=>({...r,_tipo:'mem'})):tipo==='dec'?conDecreto().filter(r=>String(r.resp||'').trim()).map(r=>({...r,_tipo:'dec'})):recs.filter(r=>numAnio(r.cf)).map(r=>({...r,id:r.id+'::car',_rid:r.id,_tipo:'car'}))).sort((a,b)=>String(a.cf||'').localeCompare(String(b.cf||'')));
// Un número solo cuenta si señala a una única carpeta: varias carpetas comparten número.
function buscarCarpeta(texto,enNombre,textoCabecera){
  if(['auto','mem','dec','car'].includes(LF.tipo))return reconocerDocumentoLF(texto,LF.tipo,textoCabecera);
  const s=String(texto||''),nums=new Set([...s.matchAll(/(?<!\d)0*(\d{1,5})\s*-\s*20\d{2}(?!\d)/g),...s.matchAll(/-20\d{2}-0*(\d{1,5})(?!\d)/g)].map(m=>m[1]));
  // En el nombre del archivo basta el número solo (1920.pdf); en el texto del documento habría demasiados números sueltos.
  if(enNombre&&!nums.size)for(const m of s.matchAll(/(?<!\d)0*(\d{2,5})(?!\d)/g))if(!/^20(2[4-9]|30)$/.test(m[1]))nums.add(m[1]);
  const l=candidatosLF().filter(r=>nums.has(numCarpeta(r)));
  return l.length===1?l[0].id:'';
}
function loteFirmHTML(){
  const c=candidatosLF();
  const opciones=id=>'<option value="">— Escoge el documento y su carpeta —</option>'+c.map(r=>'<option value="'+esc(r.id)+'"'+(r.id===id?' selected':'')+'>'+esc([(r._tipo==='mem'?'Memo '+r._num+'-'+(r._anio||'año por completar'):r._tipo==='dec'?'Decreto '+(r.dec||'sin número'):'Cargo Fiscalía'),r.cf||r.ofi||r.id,r.resp].filter(Boolean).join(' · '))+'</option>').join('');
  const fila=(f,i)=>'<div class="adj-fila"><div style="flex:1;min-width:200px"><b>'+esc(f.nombre)+'</b> '+(f.estado==='leyendo'?'<span class="tag t-blue">Leyendo…</span>':f.estado==='error'?'<span class="tag t-red">No se pudo leer: quítala y súbela aparte</span>':f.id?'<span class="tag t-green">Reconocida: revisa</span>':'<span class="tag t-amber">Escoge la carpeta</span>')+'</div>'+
    '<label style="flex:2;min-width:240px">Carpeta<select data-lfcarp="'+i+'">'+opciones(f.id)+'</select></label>'+
    (f.esCargo||f.id?.endsWith('::car')||LF.tipo==='car'?'<label>Fecha del sello de recibido<input type="date" data-lffec="'+i+'" max="'+esc(today())+'" value="'+esc(f.fecha||'')+'"></label>'+'<label>Fecha del oficio<input type="date" data-lfdocfecha="'+i+'" value="'+esc(f.fechaDocumento||'')+'"></label><label>Documento formulado<input data-lfdocumento="'+i+'" value="'+esc(f.documento||'')+'" placeholder="Informe N.° …"></label>':'')+
    (f.avisoReconocimiento?'<p class="tag t-amber">'+esc(f.avisoReconocimiento)+'</p>':'')+(f.error?'<p class="aviso-error">'+esc(f.error)+'</p>':'')+'<button class="btn" data-lfver="'+i+'">Ver archivo</button><button class="btn" data-lfquitar="'+i+'">Quitar de la lista</button></div>';
  return '<div class="panel"><h2>Subir cargos y firmados por lote</h2><fieldset'+(LF.ocupado?' disabled':'')+' style="border:0;padding:0;margin:0"><div class="row" style="margin:10px 0">'+
    '<label>Qué vas a subir<select id="lfTipo"><option value="auto"'+(LF.tipo==='auto'?' selected':'')+'>Detectar memos, decretos y cargos de Fiscalía</option><option value="dec"'+(LF.tipo==='dec'?' selected':'')+'>Cargos de decretos / decretos firmados</option><option value="mem"'+(LF.tipo==='mem'?' selected':'')+'>Cargos de memorándums / memos firmados</option><option value="car"'+(LF.tipo==='car'?' selected':'')+'>Cargos de remisión a la Fiscalía</option></select></label>'+
    (LF.tipo==='car'?'<label>Fecha del sello para todos (opcional)<input type="date" id="lfFecha" max="'+esc(today())+'" value="'+esc(LF.fecha)+'"></label>':'')+
    '<label>Cómo viene el PDF<select id="lfSeparar"><option value="si"'+(LF.separar?' selected':'')+'>Un cargo por hoja: separar páginas</option><option value="no"'+(!LF.separar?' selected':'')+'>Un documento por archivo: conservar PDF completo</option></select></label>'+
    '<label class="grow">PDF o fotos<input type="file" id="lfArchivos" multiple accept="application/pdf,image/*"></label></div>'+
    (LF.tipo==='car'?'<p class="muted">Revisa la carpeta y fecha del sello antes de pulsar Guardar.</p>':'<label class="filtro-check"><input type="checkbox" id="lfAuto"'+(LF.auto?' checked':'')+'>Guardar automáticamente memos y decretos reconocidos</label>')+'<p class="muted" style="margin:8px 0">Se reconoce cada hoja por tipo, número y carpeta fiscal. Los cargos de Fiscalía muestran la fecha del oficio y la del sello; revísalas y confirma su guardado. Las coincidencias dudosas quedan aquí para elegir su destino. Los cargos de memos y decretos acreditan su recepción; no descargan la carpeta ante la Fiscalía. Para memos anteriores, completa primero su número y fecha en la ficha.</p>'+
    '<div id="lfAviso"></div>'+(LF.hecho?'<p style="margin-bottom:8px"><span class="tag t-green">'+esc(LF.hecho)+'</span></p>':'')+LF.filas.map(fila).join('')+
    (LF.filas.length?'<div class="row" style="margin-top:8px"><button class="btn main" id="lfGuardar">Guardar los destinos elegidos</button><button class="btn" id="lfVaciar">Vaciar lista</button></div>':'')+'</fieldset>'+(LF.ocupado?'<p role="status">Leyendo o guardando documentos… Espera a que termine.</p>':'')+'</div>';
}
function pintarLF(){const el=$('decLote');if(el)el.innerHTML=loteFirmHTML()}
// Lee la hoja probando su orientación: los escaneos suelen venir girados. Devuelve la carpeta y el giro correcto.
async function leerGirando(lienzo){
  const w=await ocr();
  let giro=0,mejor=-1,datosMejores={};
  for(const rot of [0,90,270,180]){
    const cv=await lienzo(rot),texto=(await reconocerTextoOcr(w,cv)).data.text;
    let id=buscarCarpeta(texto);
    if(!id&&/MEMOR|DECRETO/.test(nrm(texto))){
      const cab=document.createElement('canvas'),alto=Math.ceil(cv.height*.28);
      cab.width=Math.ceil(cv.width*1.5);cab.height=Math.ceil(alto*1.5);
      cab.getContext('2d').drawImage(cv,0,0,cv.width,alto,0,0,cab.width,cab.height);
      const encabezado=(await reconocerTextoOcr(w,cab)).data.text;cab.width=cab.height=0;
      id=buscarCarpeta(texto,false,encabezado);
    }
    let datos={};
    if(id.endsWith('::car')||/\bCARG\s*O\b/.test(nrm(texto).slice(0,900))){
      const sello=document.createElement('canvas'),y=Math.floor(cv.height*.58),ancho=Math.ceil(cv.width*.65),alto=cv.height-y;
      sello.width=Math.ceil(ancho*1.5);sello.height=Math.ceil(alto*1.5);
      sello.getContext('2d').drawImage(cv,0,y,ancho,alto,0,0,sello.width,sello.height);
      let textoSello=(await reconocerTextoOcr(w,sello)).data.text;
      datos=datosCargoLeido(texto,textoSello);
      if(!datos.fechaSugerida){
        const roja=tintaRojaSello(sello);
        if(roja){
          try{const fechaRoja=(await reconocerTextoOcr(w,roja,{tessedit_pageseg_mode:'7',tessedit_char_whitelist:'0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ ./'})).data.text;datos=datosCargoLeido(texto,'MINISTERIO PUBLICO RECIBIDO '+fechaRoja)}
          finally{roja.width=roja.height=0}
        }
      }
      sello.width=sello.height=0;
      datos.esCargo=true;datos.avisoReconocimiento=avisoCargoFiscal(texto);
    }
    cv.width=cv.height=0;
    if(id)return {id,giro:rot,...datos};
    // Una hoja girada también produce "palabras": solo cuentan las que un documento de estos sí trae.
    const claves=new Set((nrm(texto).match(/VENTANILLA|POLICIA|COMISARIA|FISCAL|CARPETA|OFICIO|DECRETO|MINISTERIO|PUBLICO|RECIBIDO|DILIGENCIAS|DOCUMENTO/g)||[])).size;
    if(claves>mejor){mejor=claves;giro=rot;datosMejores=datos}
    if(claves>=3)break;
  }
  return {id:'',giro,...datosMejores};
}
async function lienzoPagina(pag,rot,escala){
  const vp=pag.getViewport({scale:escala,rotation:(pag.rotate+rot)%360}),cv=document.createElement('canvas');
  cv.width=vp.width;cv.height=vp.height;
  await pag.render({canvasContext:cv.getContext('2d'),viewport:vp}).promise;
  return cv;
}
async function lienzoImagen(file,rot){
  const img=await createImageBitmap(file),giro=rot%180!==0,cv=document.createElement('canvas');
  cv.width=giro?img.height:img.width;cv.height=giro?img.width:img.height;
  const c=cv.getContext('2d');
  c.translate(cv.width/2,cv.height/2);c.rotate(rot*Math.PI/180);c.drawImage(img,-img.width/2,-img.height/2);
  img.close();
  return cv;
}
const leerPagina=async pag=>{
  const c=await pag.getTextContent(),texto=c.items.map(x=>x.str).join(' ');
  if(texto.replace(/\s/g,'').length>=80){const id=buscarCarpeta(texto);if(id&&!id.endsWith('::car'))return {id,giro:0};}
  return leerGirando(rot=>lienzoPagina(pag,rot,2));
};
async function agregarFirmados(files){
  if(LF.ocupado)return;
  LF.ocupado=true;
  try{
  const todos=[...files],validos=todos.filter(archivoValido),malos=todos.length-validos.length;
  LF.hecho='';
  const avisoMalos=()=>{if(malos&&$('lfAviso'))$('lfAviso').innerHTML='<p class="aviso-error">'+malos+' archivo(s) no son PDF ni foto y no se agregaron.</p>'};
  const pendientes=validos.map(file=>({file,nombre:file.name,estado:'leyendo',id:'',fecha:LF.fecha}));
  LF.filas.push(...pendientes);pintarLF();avisoMalos();
  // Uno por uno: leer un escaneado ocupa mucha memoria.
  for(const f of pendientes){
    try{
      const esPdf=f.file.type==='application/pdf'||/\.pdf$/i.test(f.nombre);
      if(!esPdf){
        Object.assign(f,await leerGirando(rot=>lienzoImagen(f.file,rot)));if(f.fechaSugerida)f.fecha=f.fechaSugerida;
      }else{
        const lib=await pdfjs(),pdf=await lib.getDocument({data:await f.file.arrayBuffer(),isEvalSupported:false}).promise;
        if(pdf.numPages===1||!LF.separar){
          Object.assign(f,await leerPagina(await pdf.getPage(1)));if(f.fechaSugerida)f.fecha=f.fechaSugerida;
          if(pdf.numPages>1){
            // No se guarda automáticamente un PDF completo que menciona destinos diferentes.
            for(let p=2;p<=pdf.numPages;p++){const otro=(await leerPagina(await pdf.getPage(p))).id;if(otro&&otro!==f.id){f.id='';f.error='Hay distintos documentos en este PDF. Elige separar páginas o revisa el archivo.';break}}
          }
        }else{
          // Varias hojas en un PDF: cada una es un documento y se guarda como imagen derecha.
          const base=f.nombre.replace(/\.[^.]+$/,''),hojas=[];
          for(let n=1;n<=pdf.numPages;n++)hojas.push(n===1?f:{nombre:f.nombre+' · hoja '+n,estado:'leyendo',id:'',fecha:LF.fecha});
          f.nombre+=' · hoja 1';
          LF.filas.splice(LF.filas.indexOf(f)+1,0,...hojas.slice(1));pintarLF();
          for(let n=1;n<=pdf.numPages;n++){
            const h=hojas[n-1],pag=await pdf.getPage(n);
            try{
              const lectura=await leerPagina(pag),{id,giro}=lectura;
              const cv=await lienzoPagina(pag,giro,2);
              const blob=await new Promise(ok=>cv.toBlob(ok,'image/jpeg',.85));
              cv.width=cv.height=0;
              h.file=new File([blob],base+' - hoja '+n+'.jpg',{type:'image/jpeg'});
              Object.assign(h,lectura);if(h.fechaSugerida)h.fecha=h.fechaSugerida;
            }catch(e){console.error(e);h.error='No se pudo leer esta hoja. Revisa el archivo.'}
            h.estado=h.error?'error':'listo';pintarLF();avisoMalos();
          }
          await pdf.destroy();continue;
        }
        await pdf.destroy();
      }
    }catch(e){console.error(e);f.error='No se pudo leer el archivo. Revisa el formato o elige su destino manualmente.'}
    f.estado=f.error?'error':'listo';pintarLF();avisoMalos();
  }
  }finally{LF.ocupado=false;pintarLF()}
  if(LF.auto&&LF.tipo!=='car')await guardarFirmados(null,true);
}
async function guardarFirmados(boton,automatico=false){
  if(LF.ocupado)return;
  const aviso=m=>{$('lfAviso').innerHTML='<p class="aviso-error">'+esc(m)+'</p>'};
  if(LF.filas.some(f=>f.estado==='leyendo'))return aviso('Espera a que termine de leer los archivos.');
  const elegidos=LF.filas.filter(f=>f.id&&f.file&&f.estado!=='error'&&(!automatico||!f.manual));
  if(!elegidos.length)return;
  LF.ocupado=true;pintarLF();
  let n=0;const quedan=[];
  for(const f of LF.filas){
    if(!elegidos.includes(f)){quedan.push(f);continue}
    try{
      const destino=candidatosLF().find(r=>r.id===f.id);
      if(!destino)throw Error('El destino cambió. Vuelve a elegirlo.');
      const tipo=destino._tipo||LF.tipo;
      if(automatico&&tipo==='car'){f.error='Carpeta reconocida. Revisa la fecha del sello y pulsa Guardar los destinos elegidos para confirmar el descargo.';quedan.push(f);continue}
      if(LF.filas.filter(x=>x.id===f.id).length>1)throw Error('Varias hojas apuntan al mismo documento. Revísalas para conservar el cargo completo.');
      if(f.file.size>25*1024*1024)throw Error('El archivo supera 25 MB.');
      if(tipo==='car'&&(!isISO(f.fecha)||f.fecha>today()))throw Error('Completa una fecha válida del sello de la Fiscalía.');
      await guardarAhora();
      if(tipo==='mem')await guardarCargoMemo(destino,f.file);
      else{
        const r=byId.get(destino._rid||f.id),clave=claveAdj(r.id,tipo);
        if(r[ADJ[tipo].k]||await adjLeer(clave))throw Error('Este documento ya tiene un archivo. Se conserva el anterior; revisa este cargo.');
        await guardarAdj(r,tipo,f.file,f.fecha||'',f.documento||'',{fechaDocumento:f.fechaDocumento});
      }
      n++;
    }catch(e){console.error(e);f.error=e.message;quedan.push(f)}
  }
  LF.filas=quedan;
  LF.ocupado=false;
  LF.hecho=n+' archivo(s) guardado(s). '+quedan.length+' pendiente(s) de revisión.';
  render();
}
async function guardarCargoMemo(d,f){
  const r=byId.get(d._rid),documento=claveAdj(r.id,'memo-'+d._num+'-'+(d._anio||'sin-anio')+'-'+d._ef);
  if((r.adjMemos||[]).some(x=>(x.documento||x.clave)===documento))throw Error('Este memorándum ya tiene cargo guardado. Se conserva el anterior.');
  const clave=documento+'-'+(globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+Math.random().toString(36).slice(2));
  await adjPoner(clave,f);
  const meta={clave,documento,n:f.name,f:new Date().toISOString(),numero:d._num,anio:d._anio,efectivo:d._ef,resp:d.resp};
  setField(r.id,'adjMemos',[...(r.adjMemos||[]),meta]);
  await guardarAhora();
}
function cargosMemoHTML(r){
  return (r.adjMemos||[]).map(m=>'<div class="adj-fila"><div><b>Cargo de memorándum '+esc(m.numero)+'-'+esc(m.anio||'sin año')+'</b><br>'+esc(m.resp||'')+'<br><span class="muted">'+esc(m.n)+' · '+esc(fechaHora(m.f))+'</span></div><button class="btn" data-memover="'+esc(m.clave)+'">Ver cargo</button></div>').join('');
}
async function abrirCargoMemo(clave){
  return visualizarAdjunto(clave);
}
async function verAdj(tipo){
  return visualizarAdjunto(claveAdj(S.cur,tipo));
}
async function quitarAdj(tipo){
  const r=byId.get(S.cur),a=ADJ[tipo],m=r[a.k];
  if(!confirm('¿Quitar "'+m.n+'" de esta carpeta?'+(tipo==='car'?' Volverá al estado que tenía antes de subir el cargo.':'')))return;
  try{await adjQuitar(claveAdj(r.id,tipo))}catch(e){avisoAdj(e.message);return}
  if(tipo==='car'){
    setField(r.id,'obs',m.obsAnt||'');setField(r.id,'rem',m.remAnt||'NO');setField(r.id,'doc',m.docAnt||'');
  }else if(tipo==='dec')setField(r.id,'decf','');
  setField(r.id,a.k,'');
  render();
}

// Archivos guardados y visor local: PDF se dibuja con pdf.js; nunca se ejecuta HTML adjunto.
let ARCHIVOS=[],consultaArchivos=0;
async function inventarioArchivos(){
  if(SRV)return peticionDocumento('api/adjuntos',{},r=>{if(!r.ok||r.redirected)throw Error('No se pudo consultar los documentos de la base.');return r.json()},30000);
  const claves=await adjListar(),datos=await opAdj('readonly',s=>s.getAll());
  return claves.map((clave,i)=>({clave,nombre:datos[i]?.nombre||clave,tipo:datos[i]?.tipo||''}));
}
async function vArchivos(){
  const consulta=++consultaArchivos;
  $('app').innerHTML=cabecera('Documentos guardados','Archivos','Consulta los decretos firmados, cargos de memos, informes y cargos de remisión guardados en esta base')+'<div class="panel"><div class="row"><label class="grow">Buscar documento<input type="search" id="archivosBuscar" placeholder="Carpeta, efectivo o nombre del archivo" value="'+esc(S.archivosQ||'')+'"></label><button class="btn" id="archivosActualizar">Actualizar lista</button></div></div><div id="archivosLista" aria-live="polite">Consultando documentos…</div>';
  try{const lista=await inventarioArchivos();if(consulta!==consultaArchivos||S.view!=='archivos')return;ARCHIVOS=lista;pintarArchivos()}
  catch(e){if(consulta===consultaArchivos&&S.view==='archivos')$('archivosLista').textContent=e.message}
}
function datosArchivo(a){
  const id=String(a.clave).split('|')[0],r=byId.get(id),tipo=String(a.clave).slice(id.length+1);
  const memo=(r?.adjMemos||[]).find(m=>m.clave===a.clave);
  const adicional=(r?.documentos||[]).find(m=>m.clave===a.clave);
  const pendiente=(store.cfg.archivosPendientes||[]).find(m=>m.clave===a.clave);
  const meta=adicional||memo||pendiente||(ADJ[tipo]?r?.[ADJ[tipo].k]:null)||{};
  return {r,titulo:pendiente?(/^PENDIENTE-ORIGINAL\|/.test(a.clave)?'Oficio pendiente de vincular':'Cargo pendiente de vincular'):adicional?(TIPOS_DOC_CARPETA[adicional.tipo]||'Otro documento'):memo?'Cargo de memorándum '+memo.numero+'-'+(memo.anio||''):ADJ[tipo]?.t||'Documento adjunto',persona:memo?.resp||r?.resp||'',nombre:a.nombre||adicional?.n||memo?.n||'Documento',fechaDocumento:meta.fechaDocumento||'',fechaSello:meta.fecha||'',observacion:pendiente?.observacion||'',pendiente:!!pendiente};
}
// Un archivo pendiente se pasa a los documentos de la carpeta elegida, o se quita si era una copia repetida.
function vincularHTML(x){
  const ops=recs.slice().sort((a,b)=>String(a.cf||a.ofi||'').localeCompare(String(b.cf||b.ofi||''),'es',{numeric:true})).map(r=>'<option value="'+esc(r.id)+'">'+esc((r.cf||r.ofi||r.id)+' · '+(r.resp||'sin efectivo'))+'</option>').join('');
  return '<div class="fields" style="margin-top:10px"><label>Carpeta<select data-vinccarp="'+esc(x.a.clave)+'"><option value="">— Escoge la carpeta —</option>'+ops+'</select></label>'+
   '<label>Qué documento es<select data-vinctipo="'+esc(x.a.clave)+'">'+Object.entries(TIPOS_DOC_CARPETA).map(([k,t])=>'<option value="'+k+'">'+esc(t)+'</option>').join('')+'</select></label></div>'+
   '<div class="row" style="margin-top:8px"><button class="btn main" data-vincular="'+esc(x.a.clave)+'">Vincular a la carpeta</button><button class="btn" data-descartar="'+esc(x.a.clave)+'">Es copia repetida: quitar</button></div><div data-vincaviso="'+esc(x.a.clave)+'"></div>';
}
async function vincularPendiente(clave,boton,quitar){
  const caja=boton.closest('article'),aviso=m=>{const el=caja.querySelector('[data-vincaviso]');if(el)el.innerHTML='<p class="aviso-error">'+esc(m)+'</p>'};
  const pend=(store.cfg.archivosPendientes||[]).find(m=>m.clave===clave);if(!pend)return vArchivos();
  if(quitar){if(!confirm('¿Quitar "'+(pend.n||'este archivo')+'" de la base? Úsalo solo si es una copia repetida; el original sigue en tu computadora.'))return}
  else{
    const id=caja.querySelector('[data-vinccarp]').value,tipo=caja.querySelector('[data-vinctipo]').value;
    if(!byId.get(id))return aviso('Escoge la carpeta.');
    boton.disabled=true;
    try{
      const d=await adjLeer(clave);if(!d?.archivo)throw Error('No se encontró el archivo guardado.');
      await guardarDocumentoCarpeta(id,tipo,new File([d.archivo],pend.n||d.nombre||'documento',{type:d.tipo||d.archivo.type||'application/pdf'}));
    }catch(e){boton.disabled=false;return aviso(e.message)}
  }
  store.cfg.archivosPendientes=(store.cfg.archivosPendientes||[]).filter(m=>m.clave!==clave);save();await guardarAhora();
  try{await adjQuitar(clave)}catch(e){}
  vArchivos();
}
function fechasArchivoHTML(d){return (d.fechaDocumento?'<br><span class="muted">Fecha del oficio: '+esc(corta(d.fechaDocumento))+'</span>':'')+(d.fechaSello?'<br><span class="tag t-green">Recibido en Fiscalía: '+esc(corta(d.fechaSello))+'</span>':'')+(d.observacion?'<p class="tag t-amber">'+esc(d.observacion)+'</p>':'')}
const TIPOS_DOC_CARPETA={fiscal:'Oficio de la Fiscalía / remisión de carpeta',cumplimiento:'Oficio de cumplimiento / remisión a Fiscalía',memo:'Memorándum',ampliacion:'Ampliación / disposición fiscal',otro:'Otro documento'};
function documentosDeFicha(id,lista){
  const ids=new Set([id,...(ADIC||[]).filter(r=>r.adic===id).map(r=>r.id)]);
  return lista.filter(a=>ids.has(String(a.clave).split('|')[0]));
}
let consultaFichaDocumentos=0;
async function cargarDocumentosFicha(id){
  const turno=++consultaFichaDocumentos;
  try{
    const lista=documentosDeFicha(id,await inventarioArchivos());
    if(turno!==consultaFichaDocumentos||S.view!=='ficha'||S.cur!==id)return;
    const pendientes=ENVIOS.filter(x=>x.carpeta===id&&x.estado!=='aceptado');
    $('fichaDocumentos').innerHTML='<div class="resultados"><span>'+lista.length+' archivo(s) guardado(s)</span><button class="btn" id="fichaDocsActualizar">Actualizar documentos</button></div>'+(lista.length?lista.map(a=>{const d=datosArchivo(a);return '<article class="adj-fila"><div><b>'+esc(d.titulo)+'</b>'+(d.r?.adic?' <span class="tag t-blue">Decreto adicional</span>':'')+'<br><span class="muted">'+esc(d.nombre)+'</span>'+fechasArchivoHTML(d)+'</div><button class="btn main" data-archivover="'+esc(a.clave)+'">Visualizar</button></article>'}).join(''):'<p class="muted">No hay archivos subidos para esta carpeta. Abre «Agregar documentos a esta carpeta» para guardar el oficio fiscal, cumplimiento u otros documentos.</p>')+pendientes.map(x=>'<div class="adj-fila"><div><b>Documento recibido, pendiente de guardar en carpeta</b><br>'+esc(x.nombre)+'</div><button class="btn" data-envver="'+x.id+'">Visualizar</button></div>').join('');
  }catch(e){if(turno===consultaFichaDocumentos&&S.view==='ficha'&&S.cur===id)$('fichaDocumentos').textContent='No se pudo consultar los archivos. '+e.message}
}
const documentosIntentados=new WeakMap();
let documentosEnCurso=0;
async function guardarDocumentoCarpeta(id,tipo,f){
  const r=byId.get(id);if(!r||!Object.hasOwn(TIPOS_DOC_CARPETA,tipo))throw Error('Carpeta o tipo de documento no válido.');
  if(!f||!archivoValido(f)||!f.size||f.size>25*1024*1024)throw Error('Elige un PDF o foto de hasta 25 MB.');
  let destinos=documentosIntentados.get(f);if(!destinos){destinos=new Map();documentosIntentados.set(f,destinos)}
  const destino=id+'|'+tipo;
  let intento=destinos.get(destino);
  if(!intento){const clave=claveAdj(id,'documento-'+(globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+Math.random().toString(36).slice(2)));intento={meta:{clave,tipo,n:f.name,f:new Date().toISOString()},promesa:null};destinos.set(destino,intento)}
  if(intento.promesa)return intento.promesa;
  intento.promesa=(async()=>{
    documentosEnCurso++;
    try{
      await guardarAhora();
      const actual=byId.get(id);if(!actual)throw Error('La carpeta ya no está disponible.');
      if(!(actual.documentos||[]).some(m=>m.clave===intento.meta.clave)){
        await adjPoner(intento.meta.clave,f);
        setField(id,'documentos',[...(actual.documentos||[]),intento.meta]);
      }
      await guardarAhora();return intento.meta;
    }finally{documentosEnCurso--}
  })();
  try{return await intento.promesa}finally{intento.promesa=null}
}
window.addEventListener('beforeunload',e=>{if(documentosEnCurso){e.preventDefault();e.returnValue=''}});
async function subirDocumentosCarpeta(boton){
  const id=S.cur,tipo=$('docCarpetaTipo').value,input=$('docCarpetaArchivos'),archivos=[...(input.files||[])];
  if(!archivos.length)return avisoAdj('Selecciona uno o varios archivos.');
  if(boton.disabled)return;boton.disabled=true;let n=0;
  try{for(const f of archivos){await guardarDocumentoCarpeta(id,tipo,f);n++}input.value='';if(S.view==='ficha'&&S.cur===id){await cargarDocumentosFicha(id);avisoAdj(n+' documento(s) guardado(s).')}}
  catch(e){if(S.view==='ficha'&&S.cur===id){await cargarDocumentosFicha(id);avisoAdj(n+' archivo(s) confirmado(s). '+e.message+' Revisa la lista antes de repetir los restantes.')}}
  finally{boton.disabled=false}
}
function pintarArchivos(){
  const el=$('archivosLista');if(!el)return;
  const terminos=nrm(S.archivosQ||'').split(' ').filter(Boolean);
  const lista=ARCHIVOS.map(a=>({a,...datosArchivo(a)})).filter(x=>terminos.every(t=>nrm([x.nombre,x.titulo,x.persona,x.r?.cf,x.r?.id].join(' ')).includes(t))).sort((a,b)=>String(b.a.fecha||'').localeCompare(String(a.a.fecha||''))||a.nombre.localeCompare(b.nombre));
  el.innerHTML='<p class="muted" style="margin-bottom:12px">'+lista.length+' de '+ARCHIVOS.length+' documento(s) guardado(s)</p>'+(lista.length?lista.map(x=>'<article class="panel archivo-guardado"><div><span class="eyebrow">'+esc(x.titulo)+'</span><h3>'+esc(x.nombre)+'</h3><p>'+esc(x.r?.cf||'Sin carpeta identificada')+' · '+esc(x.persona)+(x.r?.adic?' · Decreto adicional':'')+'</p>'+fechasArchivoHTML(x)+(x.pendiente?vincularHTML(x):'')+'</div><div class="row"><button class="btn main" data-archivover="'+esc(x.a.clave)+'">Visualizar</button>'+(x.r?'<button class="btn" data-id="'+esc(x.r.id)+'">Abrir carpeta</button>':'')+'</div></article>').join(''):'<div class="panel vacio"><b>'+(!ARCHIVOS.length?'Esta base todavía no tiene archivos adjuntos':'No hay coincidencias')+'</b><p>'+(!ARCHIVOS.length?'Los archivos aparecerán después de subirlos y guardarlos. Si estaban en la página anterior, importa su respaldo con documentos desde Ajustes.':'Prueba otro nombre o número de carpeta.')+'</p></div>');
}
const VISOR={sesion:0,archivo:null,nombre:'',pdf:null,carga:null,tarea:null,url:'',pagina:1,zoom:1,dibujando:false};
function limpiarVisor(){
  VISOR.sesion++;VISOR.tarea?.cancel();VISOR.tarea=null;
  const carga=VISOR.carga,pdf=VISOR.pdf;VISOR.carga=null;VISOR.pdf=null;
  if(carga)Promise.resolve(carga.destroy()).catch(()=>{});else if(pdf)Promise.resolve(pdf.destroy()).catch(()=>{});
  if(VISOR.url)URL.revokeObjectURL(VISOR.url);
  Object.assign(VISOR,{archivo:null,nombre:'',url:'',pagina:1,zoom:1,giro:0,dibujando:false});
  $('visorContenido').innerHTML='';$('visorControles').hidden=true;$('visorDescargar').disabled=true;$('visorGirar').disabled=true;
}
document.addEventListener('close',e=>{if(e.target.id==='visorArchivo')limpiarVisor()},true);
async function mostrarArchivo(leer){
  limpiarVisor();const sesion=VISOR.sesion,dialogo=$('visorArchivo');
  $('visorTitulo').textContent='Abriendo documento…';$('visorContenido').textContent='Cargando archivo…';
  if(!dialogo.open)dialogo.showModal();
  try{
    const v=await leer();if(sesion!==VISOR.sesion)return;
    if(!v?.archivo)throw Error('No se encontró este documento en la base actual.');
    VISOR.archivo=v.archivo;VISOR.nombre=v.nombre||'Documento';$('visorTitulo').textContent=VISOR.nombre;$('visorDescargar').disabled=false;
    const firma=new Uint8Array(await v.archivo.slice(0,5).arrayBuffer());if(sesion!==VISOR.sesion)return;
    if(String.fromCharCode(...firma)==='%PDF-'){
      const lib=await pdfjs();if(sesion!==VISOR.sesion)return;
      const datos=await v.archivo.arrayBuffer();if(sesion!==VISOR.sesion)return;
      const carga=lib.getDocument({data:datos,isEvalSupported:false});VISOR.carga=carga;
      const pdf=await carga.promise;if(sesion!==VISOR.sesion){await pdf.destroy();return}VISOR.pdf=pdf;
      $('visorControles').hidden=false;$('visorGirar').disabled=false;await dibujarVisor();
    }else if(/^image\/(jpeg|png|webp|gif|bmp)$/i.test(v.archivo.type||v.tipo||'')){
      VISOR.url=URL.createObjectURL(v.archivo);$('visorContenido').innerHTML='<img alt="Vista del documento" id="visorFoto">';$('visorFoto').src=VISOR.url;$('visorGirar').disabled=false;
    }else $('visorContenido').textContent='Este formato no tiene vista previa. Puedes descargarlo y abrirlo con su aplicación.';
  }catch(e){if(sesion===VISOR.sesion)$('visorContenido').textContent='No se pudo visualizar: '+(e.message||'archivo dañado o lectura interrumpida')+'. Si está disponible, usa Descargar.'}
}
async function dibujarVisor(){
  if(!VISOR.pdf||VISOR.dibujando)return;
  const sesion=VISOR.sesion;VISOR.dibujando=true;
  try{
    const pdf=VISOR.pdf,pagina=VISOR.pagina,el=$('visorContenido');el.setAttribute('aria-busy','true');
    $('visorAnterior').disabled=pagina<=1;$('visorSiguiente').disabled=pagina>=pdf.numPages;
    $('visorPagina').textContent='Página '+pagina+' de '+pdf.numPages;$('visorZoom').textContent=Math.round(VISOR.zoom*100)+'%';
    const pag=await pdf.getPage(pagina);if(sesion!==VISOR.sesion)return;
    const rotation=(pag.rotate+(VISOR.giro||0))%360;
    const base=pag.getViewport({scale:1,rotation}),ancho=Math.max(200,Math.min(1000,el.clientWidth-32))*VISOR.zoom;
    const escala=Math.min(ancho/base.width,Math.sqrt(12000000/(base.width*base.height))),vp=pag.getViewport({scale:escala,rotation});
    const cv=document.createElement('canvas');cv.width=Math.ceil(vp.width);cv.height=Math.ceil(vp.height);cv.setAttribute('aria-label','Página '+pagina);el.replaceChildren(cv);
    VISOR.tarea=pag.render({canvasContext:cv.getContext('2d'),viewport:vp});await VISOR.tarea.promise;
  }catch(e){if(sesion===VISOR.sesion)$('visorContenido').textContent='No se pudo mostrar esta página. Puedes descargar el documento.'}
  finally{if(sesion===VISOR.sesion){VISOR.dibujando=false;VISOR.tarea=null;$('visorContenido').setAttribute('aria-busy','false')}}
}
function cambiarPaginaVisor(delta){if(VISOR.pdf&&!VISOR.dibujando){VISOR.pagina=Math.max(1,Math.min(VISOR.pdf.numPages,VISOR.pagina+delta));return dibujarVisor()}}
// Escaneos de costado: gira la vista de a 90° (solo la vista; el archivo guardado no cambia).
function girarVisor(){
  if(VISOR.dibujando)return;
  VISOR.giro=((VISOR.giro||0)+90)%360;
  if(VISOR.pdf)return dibujarVisor();
  const foto=$('visorFoto');if(!foto)return;
  const g=VISOR.giro,lado=g%180!==0;
  foto.style.transform=g?'rotate('+g+'deg)':'';
  // Al quedar de costado, el alto de la foto pasa a ser su ancho: se limita para que entre en la ventana.
  foto.style.maxWidth=lado?Math.max(150,$('visorContenido').clientHeight-32)+'px':'';
  // El giro no cambia el espacio que ocupa la foto: el margen (a veces negativo) lo ajusta al tamaño girado.
  foto.style.margin=lado?((foto.offsetWidth-foto.offsetHeight)/2)+'px auto':'';
}
function zoomVisor(delta){if(VISOR.pdf&&!VISOR.dibujando){VISOR.zoom=Math.max(.5,Math.min(2.5,VISOR.zoom+delta));return dibujarVisor()}}
let ajusteVisor;
window.addEventListener('resize',()=>{clearTimeout(ajusteVisor);ajusteVisor=setTimeout(()=>{if($('visorArchivo').open&&VISOR.pdf)dibujarVisor()},150)});
function visualizarAdjunto(clave){return mostrarArchivo(()=>adjLeer(clave))}
function visualizarEnvio(id){return mostrarArchivo(async()=>{const r=await fetch('api/envio?id='+encodeURIComponent(id));if(!r.ok||r.redirected)throw Error('No se pudo leer el envío.');return {archivo:await r.blob(),nombre:ENVIOS.find(x=>x.id===+id)?.nombre||'Documento recibido'}})}

// --- Falta copiar al Excel: lo hecho en la página que el Excel todavía no tiene ---
const COL_EXCEL=[['rec','C','Fecha de recepción',1],['ofi','D','Oficio'],['cf','E','Carpeta fiscal'],['fis','F','Fiscalía'],['del','G','Delito'],['agr','H','Agraviado'],['imp','I','Imputado'],['plazo','J','Plazo'],['amp','K','Ampliaciones'],['resp','L','Efectivo a cargo'],['ent','M','Fecha de entrega',1],['venc','N','Vencimiento',1],['doc','O','Documento formulado'],['obs','P','Observación'],['aper','Q','Apersonamientos']];
function faltaExcel(){
  const base=new Map(BASE.map(b=>[b.id,b])),l=[];
  for(const r of recs){
    const b=base.get(r.id);
    for(const [k,col,t,fecha] of COL_EXCEL){
      const v=String(r[k]??'').trim();
      if(!v||(b&&v===String(b[k]??'').trim()))continue;
      l.push({r,hoja:b?r.hoja:'Fila nueva al final de '+(r.sec==='FAMILIA'?'C.F. FAMILIA':r.sec==='TRÁNSITO'?'C.F. TRANSITO':r.sec==='DELITOS'?'C.F. DELITOS':'su hoja'),fila:b?r.fila:'',col,t,v:fecha?corta(v):v});
    }
  }
  return l;
}
const GUIA_PAG=()=>document.getElementById('guia').innerHTML;
function vGuia(){
  const l=faltaExcel();
  $('app').innerHTML=cabecera('Ayuda','Guía de uso','Todo se hace con Chrome, Excel y Word, sin internet')+
   '<div class="panel" id="faltaExcel"><h2>Falta copiar al Excel ('+l.length+')</h2>'+(l.length?'<p class="muted" style="margin-bottom:10px">Haz una copia del Excel, escribe estos datos, guarda, cierra y ejecuta REGENERAR PAGINA.bat. Lo copiado desaparece de esta lista.</p><div class="scroll"><table><thead><tr><th>Hoja</th><th class="num">Fila</th><th>Carpeta</th><th>Columna</th><th>Escribir</th></tr></thead><tbody>'+l.map(x=>'<tr><td>'+esc(x.hoja)+'</td><td class="num">'+esc(x.fila)+'</td><td><span class="case">'+esc(x.r.cf||x.r.ofi||x.r.id)+'</span></td><td><b>'+esc(x.col)+'</b> '+esc(x.t)+'</td><td>'+esc(x.v)+'</td></tr>').join('')+'</tbody></table></div>':'<p class="muted">El Excel tiene todo lo que hiciste en la página.</p>')+'</div>'+
   '<div class="panel guia">'+GUIA_PAG()+'</div>';
}

// --- Enlace personal de cada efectivo y documentos que envían ---
// --- Usuario (CIP) y contraseña del efectivo, como en Moral y Disciplina ---
let CUENTAS={};
async function refrescarCuentas(){
  if(!SRV)return;
  try{const r=await fetch('api/cuentas');if(r.ok){const n=await r.json();const cambio=JSON.stringify(n)!==JSON.stringify(CUENTAS);CUENTAS=n;if(cambio&&S.view==='efectivos')render()}}catch(e){}
}
async function crearCuentasTodas(boton){
  if(!confirm('Se creará el usuario de cada efectivo activo que aún no lo tenga.\n\nUsuario: su CIP · Contraseña inicial: su DNI.\nAl primer ingreso cada uno debe cambiarla. Las cuentas que ya existen no se tocan.\n\n¿Continuar?'))return;
  boton.disabled=true;
  try{
    const r=await fetch('api/cuentas/todas',{method:'POST',headers:{...ESCRIBIR,'Content-Type':'application/json'},body:'{}'});
    if(!r.ok)throw new Error(await r.text());
    const j=await r.json(),bases=j.direcciones.filter(d=>!d.includes('127.0.0.1')),url=j.publicacion?j.publicacion.portal+'/ingresar':(bases[0]||j.direcciones[0])+'ingresar';
    await refrescarCuentas();render();
    alert(j.creadas.length+' usuario(s) creado(s). Cada uno entra en '+url+' con su CIP y su DNI, y debe cambiar la contraseña al primer ingreso.'+(j.faltan.length?'\n\nNo se crearon (completa sus datos en Efectivos):\n- '+j.faltan.join('\n- '):''));
  }catch(err){alert('No se pudieron crear: '+(err.message||'error'))}
  finally{boton.disabled=false}
}
async function crearCuenta(id){
  const e=store.efectivos.find(x=>x.id===id),hay=!!CUENTAS[id];
  if(hay&&!confirm('¿Reiniciar la contraseña de '+nombreEf(e)+'? La anterior deja de servir y se cierran sus sesiones abiertas.'))return;
  try{
    const r=await fetch('api/cuenta',{method:'POST',headers:{...ESCRIBIR,'Content-Type':'application/json'},body:JSON.stringify({efectivo:id})});
    if(!r.ok)throw new Error(await r.text());
    const j=await r.json(),bases=j.direcciones.filter(d=>!d.includes('127.0.0.1')),publico=j.publicacion;
    const url=publico?publico.portal+'/ingresar':(bases[0]||j.direcciones[0])+'ingresar';
    await refrescarCuentas();
    prompt('Entrégale estos datos a '+nombreEf(e)+' en persona. La contraseña inicial es su DNI (o una temporal si no tiene DNI anotado): al primer ingreso debe crear una propia.\n\nDirección: '+url+'\nUsuario: '+j.usuario+'\nContraseña inicial: '+j.clave+'\n\nCopia el texto:',
      'Mis carpetas fiscales · Dirección: '+url+' · Usuario: '+j.usuario+' · Contraseña inicial: '+j.clave);
  }catch(err){alert('No se pudo crear el usuario: '+(err.message||'error'))}
}
async function mostrarEnlace(id,nuevo){
  const e=store.efectivos.find(x=>x.id===id);
  try{
    const r=await fetch('api/enlace',{method:'POST',headers:{...ESCRIBIR,'Content-Type':'application/json'},body:JSON.stringify({efectivo:id,nuevo:!!nuevo})});
    if(!r.ok)throw new Error(await r.text());
    const j=await r.json(),bases=j.direcciones.filter(d=>!d.includes('127.0.0.1')),publico=j.publicacion,url=publico?(publico.entrada?publico.entrada+'#'+j.token:publico.portal+'/e/'+j.token):(bases[0]||j.direcciones[0])+'e/'+j.token;
    prompt((publico?'Acceso por internet activo. La PC debe permanecer encendida y conectada.\n\n':bases.length?'':'Por ahora este enlace solo abre en esta PC: falta permitir la conexión desde otros equipos.\n\n')+'Enlace personal de '+nombreEf(e)+'. Cópialo y envíaselo solo a él o ella:',url);
  }catch(err){alert('No se pudo crear el enlace: '+(err.message||'error'))}
}
let ENVIOS=[];
const FECHAS_REC={};
let recEnCurso=false,recGuardando=false,recRepintar=false;
const nuevosRec=()=>ENVIOS.filter(x=>x.estado==='nuevo').length;
const ESTADO_ENV={nuevo:['Por revisar','t-amber'],aceptado:['Guardado en la carpeta','t-green'],revisado:['Revisado','t-gray'],rechazado:['Observado','t-red']};
const TIPO_ENV={informe:'Informe policial',cargo:'Cargo de remisión',ampliacion:'Ampliación de investigación',otro:'Otro documento'};
async function refrescarRecibidos(forzar=false){
  if(!SRV||recEnCurso)return;
  recEnCurso=true;
  try{
    const r=await fetch('api/envios');if(!r.ok)throw new Error('No se pudo actualizar la lista.');
    const nuevos=await r.json();
    recRepintar=recRepintar||JSON.stringify(nuevos)!==JSON.stringify(ENVIOS);ENVIOS=nuevos;
    const b=document.querySelector('#nav [data-nav=recibidos]');if(b)b.textContent='Recibidos'+(nuevosRec()?' ('+nuevosRec()+')':'');
    if(S.view==='recibidos'&&(forzar||recRepintar)&&!recGuardando&&!document.activeElement?.dataset?.envfec){pintarRecibidos();recRepintar=false}
    if($('recConexion'))$('recConexion').textContent='Lista actualizada · '+new Date().toLocaleTimeString('es-PE');
  }catch(e){if($('recConexion'))$('recConexion').textContent='No se pudo actualizar. Se conserva la última lista.'}
  finally{recEnCurso=false}
}
function vRecibidos(){
  if(!SRV){$('app').innerHTML=cabecera('Mesa de Partes','Recibidos')+'<div class="panel"><p>Esta función necesita la base de datos de esta PC: abre la página con <b>ABRIR EN CHROME.bat</b>.</p></div>';return}
  $('app').innerHTML=cabecera('Mesa de Partes','Recibidos','Documentos que los efectivos envían con su enlace personal')+
   '<div class="panel search-panel"><div class="row"><label>Mostrar<select id="recFiltro"><option value="nuevo"'+(S.recFiltro==='nuevo'||!S.recFiltro?' selected':'')+'>Por revisar</option><option value="todos"'+(S.recFiltro==='todos'?' selected':'')+'>Todos</option></select></label><button class="btn" id="recActualizar">Actualizar lista</button><span class="muted" id="recConexion" role="status"></span></div></div><div id="recLista"></div>';
  pintarRecibidos();refrescarRecibidos();
}
function pintarRecibidos(){
  const el=$('recLista');if(!el)return;
  const l=ENVIOS.filter(x=>S.recFiltro==='todos'||['nuevo','revisado'].includes(x.estado));
  el.innerHTML='<div class="panel">'+(l.length?l.map(x=>{
    const r=byId.get(x.carpeta),e=store.efectivos.find(y=>y.id===x.efectivo),[est,cl]=ESTADO_ENV[x.estado]||[x.estado,'t-gray'];
    const guardar=x.estado!=='aceptado'&&r&&(x.tipo==='cargo'?'<label>Fecha del sello<input type="date" data-envfec="'+x.id+'" value="'+esc(FECHAS_REC[x.id]||'')+'" max="'+esc(today())+'"></label><button class="btn main" data-envacep="'+x.id+'">Confirmar y guardar como cargo</button>':x.tipo==='informe'?'<button class="btn main" data-envacep="'+x.id+'">Confirmar y guardar como informe</button>':'<button class="btn main" data-envacep="'+x.id+'">Confirmar y guardar documento</button>');
    return '<div class="adj-fila"><div style="flex:1;min-width:240px"><b>'+esc(r?r.cf||r.ofi||r.id:x.carpeta)+'</b> · '+esc(TIPO_ENV[x.tipo]||x.tipo)+' <span class="tag '+cl+'">'+esc(est)+'</span><br><span class="muted">'+esc(e?nombreEf(e):x.efectivo)+' · '+esc(fechaHora(x.fecha))+' · '+esc(x.nombre)+' ('+Math.max(1,Math.round(x.tam/1024))+' KB)</span>'+(x.nota?'<br><span class="muted">Nota: '+esc(x.nota)+'</span>':'')+'</div>'+
      '<div class="row"><button class="btn" data-envver="'+x.id+'">Ver documento</button><a class="btn" href="api/envio?id='+x.id+'&amp;bajar=1">Descargar</a>'+(guardar||'')+
      (['nuevo','revisado'].includes(x.estado)?(x.estado==='nuevo'?'<button class="btn" data-envest="'+x.id+'|revisado">Marcar revisado</button>':'')+'<button class="btn" data-envest="'+x.id+'|rechazado">Observar</button>':'')+'</div></div>';
  }).join(''):'<p class="muted">'+(S.recFiltro==='todos'?'Todavía no han enviado documentos.':'No hay documentos por revisar.')+'</p>')+'</div>';
}
async function estadoEnvio(id,estado){
  const respuesta=await fetch('api/envio/estado',{method:'POST',headers:{...ESCRIBIR,'Content-Type':'application/json'},body:JSON.stringify({id:+id,estado})});
  if(!respuesta.ok)throw new Error('No se pudo actualizar el estado del envío.');
  await refrescarRecibidos();
}
async function aceptarEnvio(id,boton){
  const x=ENVIOS.find(y=>y.id===+id),r=x&&byId.get(x.carpeta);
  if(!r)return alert('No se encontró la carpeta de este documento.');
  if(recGuardando)return;
  const tipo=x.tipo==='cargo'?'car':x.tipo==='informe'?'inf':'otro',docTipo=x.tipo==='ampliacion'?'ampliacion':'otro',fecha=tipo==='car'?(document.querySelector('[data-envfec="'+id+'"]')||{}).value:'';
  const yaGuardado=tipo==='otro'?(r.documentos||[]).some(m=>m.envioId===x.id):r[ADJ[tipo].k]?.envioId===x.id;
  if(tipo==='car'&&!yaGuardado&&!isISO(fecha||''))return alert('Escribe la fecha del sello de la Fiscalía.');
  if(tipo!=='otro'&&!yaGuardado&&r[ADJ[tipo].k]&&!confirm('Esta carpeta ya tiene '+ADJ[tipo].t.toLowerCase()+'. ¿Reemplazarlo por este?'))return;
  boton.disabled=true;recGuardando=true;
  try{
    if(!yaGuardado){
    const respuesta=await fetch('api/envio?id='+x.id);
    if(!respuesta.ok)throw new Error('No se pudo descargar el documento recibido.');
    const b=await respuesta.blob();
    if(tipo==='otro'){
      const meta=await guardarDocumentoCarpeta(r.id,docTipo,new File([b],x.nombre,{type:x.mime}));
      setField(r.id,'documentos',r.documentos.map(m=>m.clave===meta.clave?{...m,envioId:x.id}:m));
    }else await guardarAdj(r,tipo,new File([b],x.nombre,{type:x.mime}),fecha,'',{envioId:x.id});
    }
    await guardarAhora();
    await estadoEnvio(x.id,'aceptado');
    delete FECHAS_REC[id];
  }catch(e){console.error(e);alert('No se pudo guardar: '+(e.message||'error'));boton.disabled=false}
  finally{recGuardando=false;if(S.view==='recibidos'){pintarRecibidos();recRepintar=false}}
}
// Respaldo con los documentos: sirve para pasar todo a la base de datos de esta PC o a otra.
async function respaldoCompleto(boton){
  const texto=boton.textContent;boton.disabled=true;boton.textContent='Preparando…';
  try{
    if(SRV){
      await guardarAhora();
      const info=await capacidadesServidor();
      if(!info.restauracion_atomica)throw new Error('Activa primero la actualización con REINICIAR SERVIDOR.bat para obtener una copia consistente.');
      const r=await fetch('api/respaldo?formato=json');
      if(!r.ok||r.redirected)throw new Error('No se pudo descargar el respaldo.');
      bajar('respaldo_completo_carpetas_ventanilla_'+today()+'.json',await r.blob());return;
    }
    const adjuntos=[];
    for(const clave of await adjListar()){
      const v=await adjLeer(clave);if(!v)throw new Error('Falta un documento del respaldo.');
      const datos=await new Promise((ok,mal)=>{const f=new FileReader();f.onload=()=>ok(String(f.result).split(',')[1]||'');f.onerror=mal;f.readAsDataURL(v.archivo)});
      adjuntos.push({clave,nombre:v.nombre,tipo:v.tipo||v.archivo.type,datos});
    }
    descargar('respaldo_completo_carpetas_ventanilla_'+today()+'.json','application/json',JSON.stringify({...store,adjuntos}));
  }catch(e){console.error(e);alert(e.message||'No se pudo preparar el respaldo.')}
  finally{boton.disabled=false;boton.textContent=texto}
}
async function descargarBaseCompleta(boton){
  const texto=boton.textContent;boton.disabled=true;boton.textContent='Preparando copia…';
  try{
    await guardarAhora();
    const info=await capacidadesServidor();
    if(!info.restauracion_atomica)throw new Error('Activa primero la actualización con REINICIAR SERVIDOR.bat.');
    const r=await fetch('api/respaldo');
    if(!r.ok||r.redirected)throw new Error('No se pudo descargar la base.');
    bajar('base_carpetas_'+today()+'.db',await r.blob());
  }catch(e){alert(e.message)}finally{boton.disabled=false;boton.textContent=texto}
}
async function subirAdjuntosRespaldo(lista){
  for(const a of lista||[])await adjPoner(a.clave,new File([bytesBase64(a.datos)],a.nombre||'documento',{type:a.tipo||'application/octet-stream'}));
}
async function infoServidor(){
  const el=$('srvInfo');if(!el)return;
  try{
    const j=await capacidadesServidor();
    el.innerHTML='<p>Esta PC guarda todo: numeración, asignaciones y documentos. Cada día se hace una copia en <code>datos_servidor/respaldos</code>.</p><p style="margin-top:8px">Direcciones: '+j.direcciones.map(d=>'<code>'+esc(d)+'</code>').join(' · ')+'</p>'+
      (j.red_local?'':'<p class="muted" style="margin-top:8px">Por ahora solo se entra desde esta PC: los enlaces de los efectivos todavía no abren desde sus celulares.</p>')+
      (j.clave?'':'<p class="muted">Aún no hay contraseña para entrar desde otro equipo (CAMBIAR CONTRASENA.bat).</p>')+
      (j.restauracion_atomica?'<div class="diagnostico"><span class="tag t-green">Servidor actualizado</span><p>'+esc(j.conteos.adjuntos)+' documentos guardados · '+esc(j.conteos.envios)+' envíos recibidos.</p><p>'+esc(j.respaldo.error||('Última copia diaria: '+(fechaHora(j.respaldo.fecha)||'preparando…')+(j.respaldo.pendiente?' · actualización pendiente':'')))+'</p></div>':'<p class="aviso-error">Hay mejoras pendientes de activar. Ejecuta REINICIAR SERVIDOR.bat como administrador y luego recarga la página.</p>');
  }catch(e){el.textContent='No se pudo leer el estado del servidor.'}
}

// --- Carpetas por asignar a un efectivo ---
const porAsignar=()=>recs.filter(r=>pendiente(r)&&!String(r.resp||'').trim());
function entregas(prefijo){
  const m=new Map();
  for(const r of recs){
    if(!String(r.resp||'').trim()||!fechaDesignacion(r).startsWith(prefijo))continue;
    for(const e of efectivosDe(r))m.set(e.id,(m.get(e.id)||0)+1);
  }
  return m;
}
// Primero la sección de la carpeta y, dentro de cada una, quien recibió menos este mes y este año.
function opcionesReparto(r,c,mes,anio){
  const propia=r.sec==='FAMILIA'?'FAMILIA':r.sec==='DELITOS'?'DEINPOL':r.sec==='TRÁNSITO'?'TRÁNSITO':'';
  const orden=[...SECCIONES.filter(s=>s===propia),...SECCIONES.filter(s=>s!==propia),''];
  const activos=store.efectivos.filter(e=>e.activo);
  return '<option value="">— Escoge efectivo —</option>'+orden.map(s=>{
    const l=activos.filter(e=>seccionEf(e)===s).sort((a,b)=>(mes.get(a.id)||0)-(mes.get(b.id)||0)||(anio.get(a.id)||0)-(anio.get(b.id)||0)||a.nombre.localeCompare(b.nombre));
    return l.length?'<optgroup label="'+esc(s||'SIN SECCIÓN')+'">'+l.map(e=>'<option value="'+esc(e.id)+'">'+esc(nombreEf(e))+' · '+(mes.get(e.id)||0)+' este mes · '+(anio.get(e.id)||0)+' este año · '+c.get(e.id).p+' pendientes</option>').join('')+'</optgroup>':'';
  }).join('');
}
function vAsignar(){
  const c=cargas(),mes=entregas(today().slice(0,7)),anio=entregas(today().slice(0,4));
  const lista=porAsignar().sort((a,b)=>String(a.venc||'9').localeCompare(String(b.venc||'9')));
  const hecho=L.asignado&&byId.get(L.asignado);
  $('app').innerHTML=cabecera('Mesa de Partes','Por asignar','Carpetas pendientes sin efectivo a cargo. Primero sale la sección de la carpeta y quien recibió menos. '+(SRV?'Lo asignado se guarda en la base de datos de esta PC; pásalo al Excel desde Guía → Falta copiar al Excel':'Lo asignado se guarda en este navegador, no en el Excel'))+
   (hecho?'<div class="panel"><span class="tag t-green">Asignada</span> <span class="case">'+esc(hecho.cf||hecho.id)+'</span> a '+esc(hecho.resp)+' · Decreto N.° '+esc(hecho.dec)+' <button class="btn" data-doc="decreto" data-docid="'+esc(hecho.id)+'">Ver e imprimir decreto</button> <button class="btn" data-nav="decretos">Ver todos los decretos</button></div>':'')+
   '<div class="panel"><div class="row" style="margin-bottom:12px"><label>Siguiente N.° de decreto<input type="number" min="1" id="sigDec" value="'+esc(siguienteDecreto())+'"></label></div><div id="asigAviso"></div>'+(lista.length?'<div class="scroll"><table class="ef-tabla"><thead><tr><th>Carpeta</th><th class="hide-m">Fiscalía</th><th>Recepción</th><th>Vence</th><th>Efectivo a cargo</th><th>Fecha de entrega</th><th></th></tr></thead><tbody>'+
   lista.map(r=>'<tr><td><span class="case">'+esc(r.cf||r.ofi||r.id)+'</span><br><span class="muted">'+esc(r.del||'')+'</span></td><td class="hide-m">'+esc(r.fis||'')+'</td><td>'+esc(corta(r.rec))+'</td><td>'+esc(corta(r.venc))+'</td><td><select data-asigef aria-label="Efectivo a cargo">'+opcionesReparto(r,c,mes,anio)+'</select></td><td><input type="date" data-asigfec aria-label="Fecha de entrega" value="'+esc(today())+'"></td><td style="white-space:nowrap"><button class="btn main" data-asignar="'+esc(r.id)+'">Asignar</button> <button class="btn" data-id="'+esc(r.id)+'">Abrir</button></td></tr>').join('')+
   '</tbody></table></div>':'<p class="muted">No hay carpetas por asignar.</p>')+'</div>';
}
// --- Decretos: lo asignado en este navegador y las carpetas que el usuario indicó (CF 1920, 2005 y 257); lo anterior ya pasó ---
// Casos indicados para generar decreto, definidos en la configuración local.
const DECRETO_INDICADO=PERSONALIZACION.decretos_indicados||[];
const conDecreto=()=>recs.filter(r=>DECRETO_INDICADO.includes(r.id)||(String(r.resp||'').trim()&&(store.edits[r.id]?.resp||!r.hoja))).concat(ADIC);
const porDescargar=()=>conDecreto().filter(r=>!r.decbaj);
const ordenDec=(a,b)=>porModificacion(a,b)||String(b.ent||'').localeCompare(String(a.ent||''))||String(a.cf||'').localeCompare(String(b.cf||''));
// Evita empezar en 1 sin darse cuenta si el contador nunca se usó en este navegador.
function primerNumeroOk(r){
  if(numeroDec(r.dec)||store.cfg.sigDec||recs.some(x=>numeroDec(x.dec)))return true;
  return confirm('Este decreto saldrá con el N.° 1. Si ya hay decretos anteriores, presiona Cancelar y escribe el número en "Siguiente N.° de decreto".');
}
function filaDec(r){
  const abrir=' <button class="btn" data-id="'+esc(r.adic||r.id)+'">Abrir</button>';
  const botones=!String(r.resp||'').trim()?'<button class="btn main" data-nav="asignar">Asignar efectivo</button>':r.decbaj?
   (numeroDec(r.dec)?'<button class="btn" data-doc="decreto" data-docid="'+esc(r.id)+'">Ver e imprimir</button>':'<button class="btn" data-numdec="'+esc(r.id)+'">Ver e imprimir</button>')+' <button class="btn" data-decword="'+esc(r.id)+'">Word</button> <button class="btn" data-decquita="'+esc(r.id)+'">Volver a pendientes</button>':
   '<button class="btn main" data-decword="'+esc(r.id)+'">Descargar Word</button> <button class="btn main" data-numdec="'+esc(r.id)+'">Ver e imprimir</button> <button class="btn" data-decmarca="'+esc(r.id)+'">Ya lo tengo</button>';
  return '<tr><td><span class="case">'+esc(r.cf||r.ofi||r.id)+'</span><br><span class="muted">'+esc(r.del||'')+'</span>'+(r.adic?' <span class="tag t-blue">Decreto adicional</span>':'')+'</td><td>'+(String(r.resp||'').trim()?esc(r.resp):'<span class="muted">sin efectivo</span>')+'</td><td>'+esc(corta(r.ent))+'</td><td>'+(numeroDec(r.dec)?esc(r.dec):'<span class="muted">sin número</span>')+(r.adjDec?' <span class="tag t-green">Firmado</span>':'')+'</td><td class="hide-m">'+esc(fechaHora(r.decbaj||r._mod))+'</td><td style="white-space:nowrap">'+botones+abrir+'</td></tr>';
}
function tablaDec(l,titulo,col){
  return '<div class="panel"><h2>'+esc(titulo)+' ('+l.length+')</h2>'+(l.length?'<div class="scroll"><table class="ef-tabla"><thead><tr><th>Carpeta</th><th>Efectivo</th><th>Entrega</th><th>N.° de decreto</th><th class="hide-m">'+esc(col)+'</th><th></th></tr></thead><tbody>'+l.map(filaDec).join('')+'</tbody></table></div>':'<p class="muted">Ninguna.</p>')+'</div>';
}
function listaDec(){
  const el=$('decLista');if(!el)return;
  const q=nrm(S.decQ||'');
  const l=conDecreto().filter(r=>!q||nrm([r.cf,r.ofi,r.resp,r.imp,r.agr,r.del,r.dec].join(' ')).includes(q)).sort(ordenDec);
  el.innerHTML=tablaDec(l.filter(r=>!r.decbaj),'Decreto no descargado','Modificada')+tablaDec(l.filter(r=>r.decbaj),'Decreto ya descargado o impreso','Descargado');
}
function vDecretos(){
  $('app').innerHTML=cabecera('Mesa de Partes','Decretos y cargos','Sube por lotes los cargos de decretos y memorándums. También puedes consultar y descargar los decretos')+
   '<div class="panel search-panel"><div class="row"><label class="grow">Buscar carpeta, efectivo, imputado, agraviado o N.° de decreto<input id="decQ" value="'+esc(S.decQ||'')+'"></label><label>Siguiente N.° de decreto<input type="number" min="1" id="sigDec" value="'+esc(siguienteDecreto())+'"></label></div></div><div id="decLote"></div><div id="decLista"></div>';
  pintarLF();listaDec();
}
function asignar(id,boton){
  const fila=boton.closest('tr'),e=store.efectivos.find(x=>x.id===fila.querySelector('[data-asigef]').value),fecha=fila.querySelector('[data-asigfec]').value;
  if(!e||!isISO(fecha)){$('asigAviso').innerHTML='<p class="aviso-error">Escoge el efectivo y la fecha de entrega.</p>';return}
  for(const [k,v] of [['resp',nombreEf(e)],['grado',e.grado],['cip',e.cip||''],['cargo',e.cargo||''],['ent',fecha]])setField(id,k,v);
  numerar(byId.get(id),fecha);
  L.asignado=id;
  render();
}

// --- Estadística: carpetas designadas por efectivo ---
function estadisticaHTML(){
  const paneles=[...document.querySelectorAll('#app .panel')].filter(p=>p.querySelector('h2')).map(p=>'<section><h2>'+esc(p.querySelector('h2').textContent)+'</h2>'+p.querySelector('table').outerHTML+'</section>').join('');
  const notas=[...document.querySelectorAll('#app .panel p.muted')].map(p=>'<p>'+esc(p.textContent)+'</p>').join('');
  const css='@page{size:A4 landscape;margin:12mm}*{box-sizing:border-box}body{font:9pt Arial,Helvetica,sans-serif;color:#000;background:#fff;margin:0}h1{font-size:13pt;margin:0 0 2pt}p{margin:0 0 3pt}h2{font-size:10.5pt;margin:0 0 4pt}section{margin-top:11pt;break-inside:avoid}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{border:.6pt solid #666;padding:2.2pt 3pt;text-align:right;font-weight:normal}th{background:#e8e8e8;font-weight:bold;font-size:8pt}th:first-child,td:first-child{text-align:left;width:34%}th:last-child,td:last-child{width:8%}tfoot th{background:#f1f1f1}.notas{margin-top:11pt;font-size:8pt}';
  const mes=S.estMes?MESES_EST[+S.estMes-1]+' ':'';
  return '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Estadística de carpetas '+esc(mes+S.estAnio)+'</title><style>'+css+'</style></head><body><h1>ESTADÍSTICA DE CARPETAS FISCALES ENTREGADAS POR EFECTIVO · '+esc((mes+S.estAnio).toUpperCase())+'</h1><p>Comisaría PNP de Ventanilla · Mesa de Partes · Generado el '+esc(corta(today()))+'</p>'+paneles+'<div class="notas">'+notas+'</div></body></html>';
}
function imprimirEstadistica(){
  const w=window.open('','_blank');
  if(!w)return alert('Chrome bloqueó la ventana. Permite las ventanas emergentes y vuelve a intentarlo.');
  w.document.write(estadisticaHTML());w.document.close();w.focus();w.print();
}
const MESES_EST=['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Set','Oct','Nov','Dic'];
const fechaDesignacion=r=>isISO(r.ent||'')?r.ent:isISO(r.rec||'')?r.rec:'';
function vEstadistica(){
  const designadas=recs.filter(r=>String(r.resp||'').trim());
  const fechadas=designadas.filter(fechaDesignacion);
  const anios=[...new Set(fechadas.map(r=>fechaDesignacion(r).slice(0,4)))].sort().reverse();
  if(!anios.includes(S.estAnio))S.estAnio=anios.includes(today().slice(0,4))?today().slice(0,4):anios[0]||'';
  const mes=S.estMes||'',sec=S.estSec??'';
  const delAnio=fechadas.filter(r=>fechaDesignacion(r).startsWith(S.estAnio));
  const vacio=()=>Array(12).fill(0);
  const filas=new Map(store.efectivos.filter(seccionEf).map(e=>[e.id,{e,nombre:nombreEf(e),m:vacio()}]));
  const sinId={nombre:'Sin efectivo identificado',m:vacio()};
  const totales=new Map([...SECCIONES,''].map(s=>[s,vacio()]));
  let compartidas=0;
  for(const r of delAnio){
    const m=+fechaDesignacion(r).slice(5,7)-1,l=efectivosDe(r);
    if(l.length>1)compartidas++;
    if(!l.length)sinId.m[m]++;
    for(const e of l){
      if(!filas.has(e.id))filas.set(e.id,{e,nombre:nombreEf(e),m:vacio()});
      filas.get(e.id).m[m]++;
    }
    for(const s of new Set(l.length?l.map(seccionEf):[''])) totales.get(s)[m]++;
  }
  const suma=a=>a.reduce((x,y)=>x+y,0);
  const iMes=mes?+mes-1:-1,valor=f=>mes?f.m[iMes]:suma(f.m);
  const c=cargas(),pend=f=>f.e?c.get(f.e.id).p:'';
  const opt=(v,t,cur)=>'<option value="'+esc(v)+'"'+(v===cur?' selected':'')+'>'+esc(t)+'</option>';
  const n=v=>v?String(v):'<span class="muted">·</span>';
  const nom=f=>esc(f.nombre)+(f.e&&!f.e.activo?' <span class="muted">(no activo)</span>':'');
  const tablaDe=(l,t)=>mes?
   '<div class="scroll"><table><thead><tr><th>Efectivo</th><th class="num">'+MESES_EST[iMes]+'</th><th class="num">Año</th><th class="num">Pendientes</th></tr></thead><tbody>'+l.map(f=>'<tr><td>'+nom(f)+'</td><td class="num"><b>'+f.m[iMes]+'</b></td><td class="num">'+suma(f.m)+'</td><td class="num">'+pend(f)+'</td></tr>').join('')+'</tbody><tfoot><tr><th>Total de carpetas</th><th class="num">'+t[iMes]+'</th><th class="num">'+suma(t)+'</th><th></th></tr></tfoot></table></div>':
   '<div class="scroll"><table><thead><tr><th>Efectivo</th>'+MESES_EST.map(x=>'<th class="num">'+x+'</th>').join('')+'<th class="num">Total</th><th class="num">Pendientes</th></tr></thead><tbody>'+l.map(f=>'<tr><td>'+nom(f)+'</td>'+f.m.map(v=>'<td class="num">'+n(v)+'</td>').join('')+'<td class="num"><b>'+suma(f.m)+'</b></td><td class="num">'+pend(f)+'</td></tr>').join('')+'</tbody><tfoot><tr><th>Total de carpetas</th>'+t.map(v=>'<th class="num">'+v+'</th>').join('')+'<th class="num">'+suma(t)+'</th><th></th></tr></tfoot></table></div>';
  const paneles=[...SECCIONES,''].filter(s=>!sec||(sec==='__OTROS'?s==='':s===sec)).map(s=>{
    const l=[...filas.values()].filter(f=>seccionEf(f.e)===s&&(s||valor(f))).sort((a,b)=>valor(a)-valor(b)||suma(a.m)-suma(b.m)||a.nombre.localeCompare(b.nombre));
    if(!s&&valor(sinId))l.push(sinId);
    if(!l.length)return '';
    return '<div class="panel"><h2>'+esc(s||'Sin sección en el rol')+'</h2>'+tablaDe(l,totales.get(s))+'</div>';
  }).join('');
  const sinFecha=designadas.length-fechadas.length;
  $('app').innerHTML=cabecera('Control de plazos','Estadística para repartir','Carpetas entregadas a cada efectivo por año y mes, según su sección del rol. Arriba sale quien recibió menos. Se cuenta por fecha de entrega; si falta, por fecha de recepción')+
   '<div class="panel search-panel"><div class="row"><label>Año<select id="estAnio">'+anios.map(a=>opt(a,a,S.estAnio)).join('')+'</select></label><label>Mes<select id="estMes">'+opt('','Todos',mes)+MESES_EST.map((t,i)=>opt(pad(i+1),t,mes)).join('')+'</select></label><label>Sección<select id="estSec">'+opt('','Todas',sec)+SECCIONES.map(s=>opt(s,s,sec)).join('')+opt('__OTROS','Sin sección',sec)+'</select></label><button class="btn" id="estImprimir">Imprimir o guardar PDF</button></div></div>'+
   (paneles||'<div class="panel"><p class="muted">No hay carpetas entregadas en este periodo.</p></div>')+
   '<div class="panel">'+
   (compartidas?'<p class="muted" style="margin-top:10px">'+compartidas+(compartidas===1?' carpeta compartida cuenta':' carpetas compartidas cuentan')+' para cada efectivo; en cada total se cuentan una sola vez.</p>':'')+
   (sinFecha?'<p class="muted" style="margin-top:6px">'+sinFecha+(sinFecha===1?' carpeta no se cuenta':' carpetas no se cuentan')+' por no tener una fecha válida.</p>':'')+'</div>';
}

// --- Word desde tus plantillas ---
const nombreArchivo=(tipo,r)=>tipo+'_'+String(r.cf||r.ofi||r.id).replace(/[^\wÑñ-]+/g,'_').replace(/^_+|_+$/g,'').slice(0,50)+'.docx';
function piezasDoc(r,doc){
  const d=document.createElement('div');d.innerHTML=docHTML(r,doc);
  const txt=s=>d.querySelector(s)?.textContent||'';
  const post=[];let linea='';
  for(const n of d.querySelector('.post')?.childNodes||[]){
    if(n.nodeName==='HR')continue;
    if(n.nodeName==='BR'){post.push(linea);linea=''}else linea+=n.textContent;
  }
  post.push(linea);
  const just=[...d.querySelectorAll('.just')].map(p=>p.textContent);
  const senor=d.querySelector('.señor b:nth-child(2)');
  const dest=[];
  if(senor){let l='';for(const n of senor.childNodes){if(n.nodeName==='BR'){dest.push(l);l=''}else l+=n.textContent}dest.push(l);dest[0]=dest[0].replace(/^:\s*/,'')}
  return {ref:txt('.dref'),titulo:txt('.dtitle'),just,fecha:txt('.right'),post,ini:txt('.ini'),dest};
}
async function wordBlob(r,doc){
  await cargarRecurso('word.js');
  const base=window.RECURSO_WORD[doc];
  const zip=await JSZip.loadAsync(bytesBase64(base));
  const p=piezasDoc(r,doc);
  const xml=new DOMParser().parseFromString(await zip.file('word/document.xml').async('string'),'application/xml');
  const nodos=[...xml.getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main','t')];
  let nombres=0,grados=0;
  for(const t of nodos){
    const v=t.textContent;
    const poner=x=>{t.textContent=x};
    if(v.startsWith('REF. :'))poner(p.ref);
    else if(v.startsWith('DECRETO N.°')||v.startsWith('MEMORÁNDUM N.°'))poner(p.titulo);
    else if(v.startsWith('Visto '))poner(p.just[0]);
    else if(v.startsWith('Me dirijo'))poner(p.just[0]);
    else if(v.startsWith('El plazo inicial'))poner(p.just[1]);
    else if(v.startsWith('Ventanilla,'))poner(p.fecha);
    else if(v===': [GRADO PNP]')poner(': '+p.dest[0]);
    else if(v==='[CARGO DEL DESTINATARIO]'){
      if(p.dest[2])poner(p.dest[2]);
      // Comparte párrafo con el grado y el nombre: sale solo esta línea, con su salto.
      else{const br=t.previousSibling;if(br?.localName==='br')br.remove();t.remove()}
    }
    else if(v==='[NOMBRES Y APELLIDOS]'){poner(doc==='memorandum'&&nombres===0?p.dest[1]:p.post[1]);nombres++}
    else if(v==='[CATEGORÍA Y N.° DE CARNÉ]')poner(p.post[0]);
    else if(v==='[GRADO PNP]'){poner(p.post[2]);grados++}
    else if(v==='[CARGO DEL JEFE DE LA DEPENDENCIA]'||v==='[CARGO DEL FIRMANTE]')poner(p.post[3]);
    else if(v==='[FIRMANTE]/[redactor]')poner(p.ini);
  }
  zip.file('word/document.xml',new XMLSerializer().serializeToString(xml));
  return zip.generateAsync({type:'blob',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',compression:'DEFLATE'});
}
const bajar=(nombre,blob)=>{const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=nombre;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000)};
async function descargarWord(r,doc,boton){
  const texto=boton?.textContent;
  if(boton){boton.disabled=true;boton.textContent='Generando…'}
  try{
    await guardarAhora();
    bajar(nombreArchivo(doc==='decreto'?'DECRETO':'MEMORANDUM',r),await wordBlob(r,doc));
    if(doc==='decreto')setField(r.id,'decbaj',new Date().toISOString());
  }
  catch(e){console.error(e);alert(e.message||'No se pudo generar el Word.')}
  finally{if(boton){boton.disabled=false;boton.textContent=texto}}
}
async function decretosZip(boton){
  boton.disabled=true;boton.textContent='Generando…';
  try{
    await guardarAhora();
    await cargarRecurso('word.js');
    const z=new JSZip();
    for(const i of L.hecho){const r=byId.get(i);if(r){z.file(nombreArchivo('DECRETO_'+r.dec,r),await wordBlob(r,'decreto'));setField(r.id,'decbaj',new Date().toISOString())}}
    bajar('DECRETOS_'+today()+'.zip',await z.generateAsync({type:'blob'}));
  }catch(e){console.error(e);alert(e.message||'No se pudo generar el ZIP.')}
  finally{boton.disabled=false;boton.textContent='Descargar todos (ZIP)'}
}

// --- Memorándum de recordatorio desde una carpeta vencida ---
// Una carpeta con dos efectivos lleva un memorándum, con su propio número, para cada uno.
const compartida=r=>efectivosDe(r).length>1;
function numeroMemo(r,e){
  const propio=e&&(r.memos||{})[e.id];
  return String((e&&compartida(r)?propio:r.mnum||propio)||'').trim();
}
function memoPara(r,e){return {...r,resp:nombreEf(e),grado:e.grado,cargo:(compartida(r)?'':r.cargo)||e.cargo||'',mnum:numeroMemo(r,e)}}
// Si la carpeta volvió a vencer con otra fecha (ampliación), su memorándum anterior ya no vale: lleva uno nuevo, con otro número.
const vencioDeNuevo=r=>!!r.mvenc&&r.mvenc!==r.venc;
const memoNuevo=(r,e)=>!numeroMemo(r,e)||vencioDeNuevo(r);
function siguienteMemo(){
  let siguiente=Math.max(1,Math.trunc(+store.cfg.sigMemo)||1);
  for(const r of recs)for(const n of [r.mnum,...Object.values(r.memos||{}),...(r.adjMemos||[]).map(m=>m.numero)])siguiente=Math.max(siguiente,numeroDec(n)+1);
  return siguiente;
}
function prepararMemo(r,e){
  const siguiente=siguienteMemo();
  if(vencioDeNuevo(r)){
    for(const k of ['mnum','mfec','pvig','ofvig','mvenc'])setField(r.id,k,'');
    setField(r.id,'memos',{});
  }
  if(!r.mvenc)setField(r.id,'mvenc',r.venc||'');
  if(!numeroMemo(r,e)){
    store.cfg.sigMemo=siguiente;
    const n=String(store.cfg.sigMemo++);
    if(e&&compartida(r))setField(r.id,'memos',{...r.memos,[e.id]:n});else setField(r.id,'mnum',n);
    save();
  }
  for(const [k,v] of Object.entries(datosMemo(r)))setField(r.id,k,v);
}
function datosMemo(r){
  const d={};
  const set=(k,v)=>{if(v&&!String(r[k]||'').trim())d[k]=v};
  set('mfec',today());
  // De tu columna de ampliación: "…AMPLIACION POR 40 DIAS…" y el oficio que la remite.
  // Solo si la misma frase habla de la ampliación: otras anotaciones traen plazos y oficios que no lo son.
  const a=nrm(r.amp);
  const tr=[...a.matchAll(/((?:\bOF(?:ICIO)?\.?\s*N\s*[°ºO.]*\s*([\d][\w\-\/]*)[^/;]{0,70}?)?)(?:AMPL|PRORR)[A-Z]*[^/;.]{0,50}?(\d{1,3})\s*\)?\s*DIAS(?:\s+(CALENDARIO|NATURALES|HABILES))?/g)].pop();
  if(ampliada(r)&&tr){
    set('pvig',tr[3]+' DIAS'+(tr[4]?' '+tr[4]:''));
    // "OF. N° 150-2026-2° FPFV": el 2 final es la fiscalía, no parte del número.
    if(tr[2])set('ofvig','OF. N° '+tr[2].replace(/(-\d{2,4})-\d$/,'$1'));
  }
  // Sin número de oficio en la nota: se cita la fecha en que llegó la ampliación, que sí está anotada.
  if(ampliada(r)&&!d.ofvig){
    const f=[...a.matchAll(/FECHA\s*:?\s*(\d{1,2})\s*([A-Z]{3})\s*(\d{2})\b[^/]*?(?:AMPL|PRORR)/g)].pop();
    const mes=f?'ENE FEB MAR ABR MAY JUN JUL AGO SET OCT NOV DIC'.split(' ').indexOf(f[2].replace('SEP','SET')):-1;
    if(mes>=0)set('ofvig','documento de ampliación recibido el '+pad(+f[1])+'/'+pad(mes+1)+'/20'+f[3]);
  }
  return d;
}

// --- Vencidas agrupadas por efectivo, con sus memorandos por lote ---
const FALTA_MEMO={'[PLAZO VIGENTE]':['pvig','Plazo vigente'],'[OFICIO O DISPOSICIÓN FISCAL VIGENTE]':['ofvig','Oficio o disposición vigente'],'[PLAZO INICIAL]':['plazo','Plazo inicial'],'[FISCALÍA / DESPACHO]':['fis','Fiscalía'],'[NÚMERO Y SIGLAS]':['ofi','Oficio'],'[NÚMERO DE CARPETA]':['cf','Carpeta fiscal'],'[FECHA DE RECEPCIÓN]':['rec','Recepción','date']};
function faltanMemo(r,e){
  const html=docHTML({...memoPara(r,e),...datosMemo(r),mnum:'1'},'memorandum');
  return [...html.matchAll(/<mark>(.*?)<\/mark>/g)].map(m=>FALTA_MEMO[m[1]]).filter(Boolean);
}
// Una sola vez por navegador: los memorandos ya generados quedan ligados a la fecha con que vencieron.
if(!store.cfg.memoV){
  for(const [id,ed] of Object.entries(store.edits)){
    if((ed.mnum||Object.keys(ed.memos||{}).length)&&!ed.mvenc){
      const b=BASE.find(x=>x.id===id)||store.nuevos.find(x=>x.id===id);
      ed.mvenc=ed.venc||b?.venc||'';
    }
  }
  store.cfg.memoV=1;save();
}
function vencidasPorEfectivo(filtro=()=>true){
  const grupos=new Map(),sin=[];
  for(const r of recs){
    if(vigencia(r)!=='VENCIDA')continue;
    const l=efectivosDe(r);
    if(!l.length)sin.push(r);
    for(const e of l){if(!filtro(r,e))continue;if(!grupos.has(e.id))grupos.set(e.id,{e,lista:[]});grupos.get(e.id).lista.push(r)}
  }
  for(const g of grupos.values())g.lista.sort((a,b)=>String(a.venc).localeCompare(String(b.venc)));
  return {grupos:[...grupos.values()].sort((a,b)=>b.lista.length-a.lista.length||a.e.nombre.localeCompare(b.e.nombre)),sin};
}
const vencidasNuevas=()=>vencidasPorEfectivo(memoNuevo).grupos.reduce((n,g)=>n+g.lista.length,0);
function vVencidas(){
  const hechas=S.venVista==='hechas';
  const cuenta=f=>vencidasPorEfectivo(f).grupos.reduce((n,g)=>n+g.lista.length,0);
  const nNuevas=cuenta(memoNuevo),nHechas=cuenta((r,e)=>!memoNuevo(r,e));
  const {grupos,sin}=vencidasPorEfectivo(hechas?(r,e)=>!memoNuevo(r,e):memoNuevo);
  const total=hechas?nHechas:nNuevas;
  const filaV=(r,e)=>{
    const f=faltanMemo(r,e),num=numeroMemo(r,e);
    const dias=Math.round((Date.parse(control())-Date.parse(r.venc))/864e5);
    return '<tr><td><span class="case">'+esc(r.cf||r.ofi||r.id)+'</span>'+(compartida(r)?' <span class="tag t-blue">Compartida</span>':'')+'<br><span class="muted">'+esc(r.fis||'')+'</span></td><td style="white-space:nowrap">'+esc(corta(r.venc))+'<br><span class="muted">hace '+dias+' días</span></td><td style="white-space:nowrap">'+(vencioDeNuevo(r)?'<span class="tag t-amber">Venció de nuevo</span><br><span class="muted">Anterior: N.° '+esc(num)+'</span>':num?'N.° '+esc(num)+'<br><span class="muted">'+esc(corta(r.mfec))+'</span>':'<span class="muted">Sin generar</span>')+'</td><td>'+
      (f.length?f.map(([k,t,tipo])=>'<label>'+esc(t)+'<input type="'+(tipo||'text')+'" data-vf="'+k+'" data-vid="'+esc(r.id)+'"></label>').join(''):'<span class="tag t-green">Completo</span>')+
      '</td><td style="white-space:nowrap"><button class="btn" data-vmemo="'+esc(r.id)+'" data-vef="'+esc(e.id)+'">Descargar</button> <button class="btn" data-id="'+esc(r.id)+'">Abrir</button></td></tr>';
  };
  $('app').innerHTML=cabecera('Recordatorios','Vencidas por efectivo',(hechas?nHechas+' con memorándum ya generado':nNuevas+' sin memorándum')+' · '+grupos.length+' efectivos · fecha de control: '+corta(control()))+
   '<div class="panel"><div class="row"><button class="btn main" id="subirMemos">Subir cargos de memorándums</button><button class="btn'+(hechas?'':' main')+'" data-venvista="nuevas">Nuevas, sin memorándum ('+nNuevas+')</button><button class="btn'+(hechas?' main':'')+'" data-venvista="hechas">Con memorándum ya generado ('+nHechas+')</button></div></div>'+
   '<div class="panel"><div class="row" style="justify-content:space-between;align-items:flex-end"><label>Siguiente N.° de memorándum<input type="number" min="1" id="sigMemo" value="'+esc(siguienteMemo())+'"></label>'+(total&&!hechas?'<button class="btn main" id="memosTodos">Descargar las nuevas ('+total+')</button>':'')+'</div>'+
   '</div>'+
   grupos.map(({e,lista})=>'<div class="panel"><div class="row" style="justify-content:space-between;margin-bottom:10px"><h2 style="margin:0">'+esc(nombreEf(e))+' <span class="tag t-red">'+lista.length+(lista.length===1?' vencida':' vencidas')+'</span></h2><div class="row">'+(SRV?'<button class="btn" data-enlace="'+esc(e.id)+'">Enlace para enviar documentos</button>':'')+(hechas?'':'<button class="btn main" data-memosef="'+esc(e.id)+'">'+(lista.length===1?'Descargar su memorándum':'Descargar sus '+lista.length+' memorandos (ZIP)')+'</button>')+'</div></div><div class="scroll"><table class="ef-tabla"><thead><tr><th>Carpeta</th><th>Venció</th><th>Memorándum</th><th>Datos</th><th></th></tr></thead><tbody>'+lista.map(r=>filaV(r,e)).join('')+'</tbody></table></div></div>').join('')+
   (!total?'<div class="panel"><p class="muted">'+(hechas?'Todavía no hay memorandos generados.':'No hay vencidas nuevas: todas tienen memorándum.')+'</p></div>':'')+
   (sin.length&&!hechas?'<div class="panel"><h2>Sin efectivo identificado ('+sin.length+')</h2><p class="muted" style="margin-bottom:10px">Su responsable no coincide con la lista de Efectivos. Corrígelo en la carpeta para que entre en su grupo.</p>'+sin.map(r=>'<p style="margin-bottom:6px"><button class="btn" data-id="'+esc(r.id)+'">Abrir</button> <span class="case">'+esc(r.cf||r.id)+'</span> <span class="muted">'+esc(r.resp||'sin responsable')+'</span></p>').join('')+'</div>':'');
}
async function bajarMemos(items,boton,nombreZip,conCarpetas){
  const nuevos=items.filter(({r,e})=>memoNuevo(r,e)).length;
  const incompletos=items.filter(({r,e})=>faltanMemo(r,e).length).length;
  const avisos=[];
  if(items.length>1&&nuevos){const n=siguienteMemo();avisos.push(nuevos===1?'Se usará el número '+n+'.':'Se usarán '+nuevos+' números nuevos: del '+n+' al '+(n+nuevos-1)+'.')}
  if(incompletos)avisos.push(incompletos===1?'1 memorándum saldrá con datos en corchetes por completar.':incompletos+' memorandos saldrán con datos en corchetes por completar.');
  if(avisos.length&&!confirm(avisos.join('\n')+'\n¿Descargar?'))return;
  const texto=boton.textContent;
  boton.disabled=true;boton.textContent='Generando…';
  try{
    await cargarRecurso('word.js');
    for(const {r,e} of items)prepararMemo(r,e);
    await guardarAhora();
    const archivo=async({r,e})=>wordBlob(memoPara(r,e),'memorandum');
    const nombre=({r,e})=>nombreArchivo('MEMORANDUM_'+numeroMemo(r,e),r);
    if(items.length===1)bajar(nombre(items[0]),await archivo(items[0]));
    else{
      const z=new JSZip();
      for(const it of items)z.file((conCarpetas?nombreEf(it.e).replace(/[^\wÑñ-]+/g,'_')+'/':'')+nombre(it),await archivo(it));
      bajar(nombreZip,await z.generateAsync({type:'blob'}));
    }
  }catch(err){console.error(err);alert(err.message||'No se pudieron generar los memorandos.')}
  render();
}
function memosDeEfectivo(id,boton){
  const g=vencidasPorEfectivo(memoNuevo).grupos.find(x=>x.e.id===id);
  if(g)bajarMemos(g.lista.map(r=>({r,e:g.e})),boton,'MEMOS_'+nrm(g.e.nombre).split(' ').slice(0,2).join('_')+'_'+today()+'.zip');
}
function memosTodos(boton){
  bajarMemos(vencidasPorEfectivo(memoNuevo).grupos.flatMap(g=>g.lista.map(r=>({r,e:g.e}))),boton,'MEMOS_VENCIDAS_'+today()+'.zip',true);
}
