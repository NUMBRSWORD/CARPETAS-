"""Lee el Excel real del usuario hoja por hoja, con el mismo mapeo e ID que normalize_data.py."""
import datetime as dt
import re
import unicodedata
import xml.etree.ElementTree as ET
import zipfile

NS={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
CODIGO={'C.F. FAMILIA':'FAM','C.F. DELITOS':'DEL','C.F. TRANSITO':'TRA','DELITOS-2024':'D24','FAMILIA 2024':'F24',' DELITOS TAYPE':'DTA','FAMILIA TAYPE':'FTA'}
ACTUAL=dict(zip(['rec','ofi','cf','fis','del','agr','imp','plazo','amp','resp','ent','venc','doc','obs','aper'],'CDEFGHIJKLMNOPQ'))
HIST=dict(zip(['rec','fis','cf','ofi','del','plazo','intv','ent','venc','fol','resp'],'BCDEFGHIJKL'))
MAPA={
 'C.F. FAMILIA':ACTUAL,'C.F. DELITOS':ACTUAL,'C.F. TRANSITO':ACTUAL,
 'DELITOS-2024':{**HIST,'doc':'M'},
 'FAMILIA 2024':{**HIST,'obs':'M','doc':'N'},
 ' DELITOS TAYPE':dict(zip(['ofi','fofi','rec','fis','cf','agr','imp','del','resp','venc','plazo','doc'],'BCDEFGHIJKLM')),
 'FAMILIA TAYPE':dict(zip(['ofi','rec','fis','desp','cf','agr','imp','del','resp','venc','plazo','obs','coord'],'CDEFGHIJKLMNO')),
}
FECHAS={'rec','fofi','ent','venc'}


def libro(path):
    with zipfile.ZipFile(path) as z:
        strings=[''.join(si.itertext()) for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si',NS)]
        rel={r.attrib['Id']:r.attrib['Target'] for r in ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
        out={}
        for sh in ET.fromstring(z.read('xl/workbook.xml')).findall('m:sheets/m:sheet',NS):
            t=rel[sh.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']]
            p=t.lstrip('/') if t.startswith('/') else 'xl/'+t
            if not p.startswith('xl/worksheets'):continue
            filas={}
            for fila in ET.fromstring(z.read(p)).iterfind('m:sheetData/m:row',NS):
                d={}
                for c in fila.findall('m:c',NS):
                    v=c.find('m:v',NS);val=v.text if v is not None else None;typ=c.get('t')
                    if typ=='s' and val is not None:val=strings[int(val)]
                    elif typ=='inlineStr':val=''.join(c.find('m:is',NS).itertext())
                    elif val is not None and typ not in ('str','e'):
                        try:
                            val=float(val);val=int(val) if val.is_integer() else val
                        except ValueError:pass
                    if val is not None and str(val).strip()!='':d[re.match(r'[A-Z]+',c.get('r'))[0]]=val
                if d:filas[int(fila.get('r'))]=d
            out[sh.get('name')]=filas
    return out


def fecha(v):
    if isinstance(v,(int,float)) and 20000<v<80000:
        return (dt.date(1899,12,30)+dt.timedelta(days=int(v))).isoformat()
    return str(v).strip()


def norm(v):
    return ''.join(c for c in unicodedata.normalize('NFD',str(v or '').strip().upper()) if unicodedata.category(c)!='Mn')


def registros(path):
    res=[]
    for hoja,filas in libro(path).items():
        if hoja not in MAPA:continue
        col_n='B' if hoja.startswith('C.F.') or hoja=='FAMILIA TAYPE' else 'A'
        seccion='FAMILIA' if 'FAMILIA' in hoja else 'TRÁNSITO' if 'TRANSITO' in hoja else 'DELITOS'
        for n,d in filas.items():
            if not isinstance(d.get(col_n),(int,float)):continue
            r={'id':f'{CODIGO[hoja]}-{n:04d}','hoja':hoja.strip(),'fila':n,'n':d[col_n],'sec':seccion}
            usadas={col_n}
            for k,c in MAPA[hoja].items():
                usadas.add(c)
                if c in d:
                    r[k]=fecha(d[c]) if k in FECHAS else str(d[c]).strip()
            otras={c:v for c,v in d.items() if c not in usadas}
            if otras:r['extra']=otras
            res.append(r)
    return res
