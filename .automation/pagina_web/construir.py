import base64
import collections
import datetime as dt
import difflib
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from zipfile import ZipFile
sys.path.insert(0,str(Path(__file__).parent))
from origen import norm,registros

sys.stdout.reconfigure(encoding='utf-8')
ROOT=Path(__file__).resolve().parent.parent.parent
# El Excel va dentro del proyecto (USB) o junto a él (Escritorio); nada depende de la letra de la unidad.
EXCEL='CARPETAS FISCALES ACTUALIZADAS 2026*.xlsx'
REAL=next(p for d in (ROOT,ROOT.parent) for p in sorted(d.glob(EXCEL)))
PERSONAL=ROOT.parent/'DNI Y CIP DEL PERSONAL 2026.xlsx'
COPIA_PERSONAL=Path(__file__).resolve().parent/'personal_2026.json'
PLANTILLA=Path(__file__).resolve().parent/'plantilla.html'
OUT=ROOT/'outputs/pagina_web_ventanilla/CARPETAS_FISCALES_VENTANILLA.html'
DOCX=ROOT/'outputs/documentos_pnp_ventanilla/DECRETO_CARPETA_FISCAL_VENTANILLA_FORMATO_33.docx'
ESCUDO=ROOT/'.automation/memo_ceopol_render/imagen_original.png'
VENDOR=Path(__file__).resolve().parent/'vendor'
SPA=VENDOR/'spa.traineddata'
# Personalización local excluida de Git. No usar valores de ejemplo sobre una instalación real.
PRIVADO=Path(__file__).resolve().parent/'privado_local.json'
if not PRIVADO.is_file():
    sys.exit('Falta privado_local.json. Conserva el de esta PC o prepara uno a partir del ejemplo.')
LOCAL=json.loads(PRIVADO.read_text(encoding='utf-8'))
VENCE_CONFIRMADO=LOCAL.get('vence_confirmado',{})
MESES={'ENE':1,'FEB':2,'MAR':3,'ABR':4,'MAY':5,'JUN':6,'JUL':7,'AGO':8,'SET':9,'SEP':9,'OCT':10,'NOV':11,'DIC':12}


def vence_en_obs(obs):
    """Fecha de "AMPLIACION VENCE EL 21NOV26" que el usuario anota en OBSERVACION."""
    t=norm(obs)
    # Con varias ampliaciones en la misma nota vale la fecha más lejana (a veces se anota primero la más nueva).
    fechas=[]
    for d,mes,y in re.findall(r'VENC(?:E|ID[AO])\s*(?:EL)?\s*(\d{1,2})\s*-?([A-Z]{3})[A-Z]*-?\s*(\d{2,4})',t):
        if mes in MESES:fechas.append((int(y)+2000 if int(y)<100 else int(y),MESES[mes],int(d)))
    for d,mes,y in re.findall(r'HASTA\s*(\d{1,2})/(\d{1,2})/(\d{4})',t):
        fechas.append((int(y),int(mes),int(d)))
    validas=[]
    for f in fechas:
        try:
            validas.append(dt.date(*f))
        except ValueError:
            pass
    return max(validas).isoformat() if validas else None


def remision(obs):
    t=re.sub(r'\s+','',norm(obs))
    if re.match(r'DES?A?C?G?[A-Z]{0,3}A?R?[GC]?A?[GC]AD[OA]',t) or re.match(r'DESC?ARGAD',t):return 'SÍ'
    if re.match(r'(VIGENTE|VENCID[OA]|AMPL|PRORRO)',t):return 'NO'
    if re.match(r'(SEDEVOLVIO|DEV[O0]LU|ARCHIV|REMITECARPETA)',t):return 'DEVUELTA/ARCHIVADA'
    return 'POR VERIFICAR'


def anio_recepcion(r):
    v=str(r.get('rec') or '').strip()
    if re.match(r'^\d{4}-\d\d-\d\d$',v):return int(v[:4])
    # Fechas escritas como texto en el archivo: "14-07-2026", "22/SET/2026".
    m=re.search(r'[-/ ](20\d{2})$',v)
    return int(m[1]) if m else None


todos=registros(REAL)
# El usuario agrega filas a mano en el Excel: no se exige una cantidad fija.
assert len({r['id'] for r in todos})==len(todos)
# Alcance pedido por el usuario: solo lo recibido desde 2026.
records=[r for r in todos if (anio_recepcion(r) or 0)>=2026]
fuera_sin_fecha=[r for r in todos if anio_recepcion(r) is None]
sin_fecha=[]
for r in records:
    r['rem']=remision(r.get('obs'))
    v=vence_en_obs(r.get('obs'))
    if r.get('venc'):r['vori']=r['venc']
    if v:r['venc']=v
    elif r['id'] in VENCE_CONFIRMADO:r['venc']=VENCE_CONFIRMADO[r['id']]
    elif r['rem']=='NO' and re.match(r'AMPL|PRORRO',norm(r.get('obs'))):
        sin_fecha.append(r['id']);r.pop('venc',None)  # Ampliación sin fecha legible: no se usa el vencimiento anterior.
    if r.get('extra'):r['otras']=' · '.join(str(x) for x in r.pop('extra').values())

# Correcciones y textos específicos se conservan únicamente en esta PC.
DATOS_DECRETO=LOCAL.get('datos_decreto',{})
ADICIONALES=LOCAL.get('adicionales',{})
for r in records:
    if r['id'] in DATOS_DECRETO:r.update(DATOS_DECRETO[r['id']])
adicionales=[{**{k:v for k,v in r.items() if k not in ('n','amp','doc','obs','aper','vori')},**ADICIONALES[r['id']],'adic':r['id']} for r in records if r['id'] in ADICIONALES]
assert len(adicionales)==len(ADICIONALES)


def leer_personal():
    """Lista de revista: si no está junto al proyecto, se usa la copia guardada."""
    if PERSONAL.exists():
        ns='{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
        with ZipFile(PERSONAL) as z:
            ss=[''.join(t.text or '' for t in si.iter(ns+'t')) for si in ET.fromstring(z.read('xl/sharedStrings.xml'))]
            hoja=ET.fromstring(z.read('xl/worksheets/sheet1.xml'))
        filas=[]
        for row in hoja.iter(ns+'row'):
            d={}
            for c in row:
                v=c.find(ns+'v')
                if v is not None:d[re.sub(r'\d','',c.get('r'))]=(ss[int(v.text)] if c.get('t')=='s' else v.text).strip()
            if not d.get('A','').isdigit():continue
            # El nombre a veces repite el CIP entre paréntesis; el DNI perdió sus ceros en Excel.
            nombre=re.sub(r'\s+',' ',re.sub(r'\(.*?\)','',d['C']).replace(',',' ')).strip()
            filas.append({'grado':d['B']+' PNP','nombre':nombre,'cip':d['D'],'dni':d['E'].zfill(8)})
        COPIA_PERSONAL.write_text(json.dumps(filas,ensure_ascii=False,indent=0),encoding='utf-8')
    return json.loads(COPIA_PERSONAL.read_text(encoding='utf-8'))


def con_personal(semillas,personal,regs):
    """Une los efectivos del registro con la lista de revista; manda la lista, salvo los que no figuran en ella."""
    clave=lambda n:' '.join(norm(n).split()[:2])
    resp=[norm(r.get('resp')) for r in regs]
    por_clave=collections.defaultdict(list)
    for p in personal:por_clave[clave(p['nombre'])].append(p)
    res,usados=[],set()
    for s in semillas:
        lista=por_clave.get(clave(s['nombre']),[])
        # Con dos personas de iguales apellidos no se adivina: entran por separado más abajo.
        if len(lista)==1:
            usados.add(lista[0]['cip'])
            res.append({**lista[0],'id':'EF-'+lista[0]['cip'],'cargo':'','activo':True})
        elif not lista:
            res.append({**s,'id':'EF-'+re.sub(r'\W+','-',clave(s['nombre'])),'dni':''})
    for p in personal:
        if p['cip'] in usados:continue
        k=clave(p['nombre'])
        aparece=any(k in t for t in resp) and len(por_clave[k])==1
        res.append({**p,'id':'EF-'+p['cip'],'cargo':'','activo':aparece})
    return res


def efectivos_iniciales(regs):
    """Lista de efectivos desde la columna SUB OFICIAL A CARGO, juntando variantes y errores de tipeo."""
    grupos={}
    for r in regs:
        for trozo in str(r.get('resp','')).split('/'):
            t=re.sub(r'\s+',' ',norm(trozo)).strip()
            m=re.search(r'\b(S\.?[123BS]|SE|ST\d|SO\d)\s*PNP\s+([A-Z][A-Z. ]+)',t) or re.search(r'\b(S[123])\s+([A-Z][A-Z. ]+)',t)
            if not m:continue
            grado=m[1].replace('.','')+' PNP'
            nombre=re.split(r'\s+(?:SE LE|FUE|CON ACTA|EL \d)',m[2])[0].strip(' .')
            if len(nombre.split())<2:continue
            k=' '.join(nombre.split()[:2])
            cerca=difflib.get_close_matches(k,list(grupos),n=1,cutoff=.84)
            g=grupos.setdefault(cerca[0] if cerca else k,{'grados':collections.Counter(),'nombres':collections.Counter()})
            g['grados'][grado]+=1;g['nombres'][nombre]+=1
    res=[]
    for i,(k,g) in enumerate(sorted(grupos.items(),key=lambda x:-sum(x[1]['nombres'].values())),1):
        # El nombre más completo entre los más usados de esa persona.
        tope=g['nombres'].most_common(1)[0][1]
        nombre=max((n for n,c in g['nombres'].items() if c>=max(1,tope//3)),key=lambda n:(len(n.split()),g['nombres'][n]))
        res.append({'id':f'EF-{i:03d}','grado':g['grados'].most_common(1)[0][0],'nombre':nombre,'cip':'','cargo':'','activo':True})
    return res


with ZipFile(DOCX) as z:sello=z.read('word/media/sello_comisaria_ventanilla.png')
uri=lambda b:'data:image/png;base64,'+base64.b64encode(b).decode()
assets={'escudo':uri(ESCUDO.read_bytes()),'sello':uri(sello)}
safe=lambda o:json.dumps(o,ensure_ascii=False,separators=(',',':')).replace('</','<\\/')
tema=(PLANTILLA.parent/'tema.css').read_text(encoding='utf-8')
lote=(PLANTILLA.parent/'lote.js').read_text(encoding='utf-8')
persistencia=(PLANTILLA.parent/'persistencia.js').read_text(encoding='utf-8')
guia=(PLANTILLA.parent/'guia.html').read_text(encoding='utf-8')
(ROOT/'GUIA DE USO LOCAL.html').write_text('<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Guía de uso local</title><style>@page{size:A4;margin:16mm}body{font:11pt/1.5 Arial,Helvetica,sans-serif;color:#16222c;background:#fff;max-width:820px;margin:0 auto;padding:18px}h1{font-size:18pt;margin:0 0 4pt}h2{font-size:13pt;margin:20px 0 6px;border-bottom:1px solid #999;padding-bottom:3px}h3{font-size:11.5pt;margin:14px 0 4px;break-after:avoid}ol,ul{padding-left:22px;margin:4px 0}table{width:100%;border-collapse:collapse;margin:8px 0;font-size:10pt}th,td{border:1px solid #999;padding:4px 7px;text-align:left;vertical-align:top}th{background:#eee}tr{break-inside:avoid}code{background:#eee;padding:0 4px}.ojo{padding:8px 11px;border-left:3px solid #8a5a00;background:#f6efe0}</style></head><body><h1>Carpetas Fiscales: guía de uso local</h1><p>Comisaría PNP de Ventanilla · Mesa de Partes</p>'+guia+'</body></html>',encoding='utf-8')
semillas=efectivos_iniciales(records)
efectivos=con_personal(semillas,leer_personal(),records)
html=PLANTILLA.read_text(encoding='utf-8').replace('__TEMA__',tema).replace('__LOTE__',lote).replace('__PERSISTENCIA__',persistencia).replace('__DATA__',safe(records+adicionales)).replace('__ASSETS__',safe(assets)).replace('__EFECTIVOS__',safe(efectivos)).replace('__PERSONALIZACION__',safe({k:LOCAL.get(k,{} if k not in ('rol_inactivo_v1','decretos_indicados') else []) for k in ('firma','rol_seccion','grado_rol','rol_inactivo_v1','decretos_indicados')})).replace('__GUIA__',guia)
OUT.parent.mkdir(exist_ok=True)
OUT.write_text(html,encoding='utf-8')

# Librerías que la página carga solo al usarlas; todo queda en tu computadora.
REC=OUT.parent/'recursos'
REC.mkdir(exist_ok=True)
tx=lambda p:(VENDOR/p).read_text(encoding='utf-8')
b64=lambda p:base64.b64encode(Path(p).read_bytes()).decode()
js=lambda o:json.dumps(o,ensure_ascii=False)
(REC/'lector_pdf.js').write_text('window.RECURSO_PDF='+js({'main':tx('pdfjs-dist/build/pdf.min.mjs'),'worker':tx('pdfjs-dist/build/pdf.worker.min.mjs')})+';',encoding='utf-8')
(REC/'lector_ocr.js').write_text(tx('tesseract.js/dist/tesseract.min.js')+'\nwindow.RECURSO_OCR='+js({'worker':tx('tesseract.js/dist/worker.min.js'),'core':tx('tesseract.js-core/tesseract-core-simd-lstm.wasm.js')})+';',encoding='utf-8')
(REC/'idioma_spa.js').write_text('window.RECURSO_SPA="'+b64(SPA)+'";',encoding='utf-8')
PL=ROOT/'outputs/documentos_pnp_ventanilla'
(REC/'word.js').write_text(tx('jszip/dist/jszip.min.js')+'\nwindow.RECURSO_WORD='+js({'decreto':b64(PL/'DECRETO_CARPETA_FISCAL_VENTANILLA_FORMATO_33.docx'),'memorandum':b64(PL/'MEMORANDUM_RECORDATORIO_VENTANILLA_FORMATO_49.docx')})+';',encoding='utf-8')
print('efectivos',len(efectivos),'activos',sum(bool(e['activo']) for e in efectivos))
print('diferencias de grado',sum(1 for s in semillas for e in efectivos if e['nombre'].split()[:2]==s['nombre'].split()[:2] and e['grado']!=s['grado']))
print('recursos MB',{f.name:round(f.stat().st_size/1e6,1) for f in REC.iterdir()})
print(json.dumps({'totalArchivo':len(todos),'porHoja':collections.Counter(r['hoja'] for r in records),'recepcionTexto':[(r['id'],r['rec']) for r in records if not re.match(r'^\d{4}-',r['rec'])],'recepcionFutura':[(r['id'],r['rec'],r.get('cf')) for r in records if r['rec'][:4]=='2027'],'fueraSinRecepcionCF':[(r['id'],str(r.get('rec') or '')[:14],str(r.get('cf') or '')[:22],str(r.get('obs') or '')[:14]) for r in fuera_sin_fecha if r['hoja'].startswith('C.F.')],'fueraSinRecepcionOtras':sum(1 for r in fuera_sin_fecha if not r['hoja'].startswith('C.F.')),'records':len(records),'rem':collections.Counter(r['rem'] for r in records),'ampliacionSinFecha':sin_fecha,'ampliacionConFecha':sum(1 for r in records if vence_en_obs(r.get('obs'))),'porVerificarEnCF':[(r['id'],r.get('obs')) for r in records if r['rem']=='POR VERIFICAR' and r['hoja'].startswith('C.F.')],'bytes':OUT.stat().st_size},ensure_ascii=False))
