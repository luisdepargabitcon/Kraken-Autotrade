#!/usr/bin/env python3
"""Datos publicos Binance Spot, investigacion NEXA: nunca opera ni usa credenciales."""
import concurrent.futures, datetime, hashlib, io, json, time, zipfile
from pathlib import Path
import numpy as np, pandas as pd, requests

PAIRS=['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','TONUSDT']
OUT=Path('nexa_ohlcv_publico'); OUT.mkdir(exist_ok=True)
BEGIN=pd.Timestamp('2026-07-01T00:00:00Z')
END=pd.Timestamp('2026-11-19T00:00:00Z')
SOURCE='https://data.binance.vision/data/spot'
NAMES=['open_ts','open','high','low','close','volume','close_ts','quote_volume',
       'trades','taker_buy_base','taker_buy_quote','ignore']
def links(sym):
    for m in ['2026-07','2026-08','2026-09','2026-10']:
        z=f'{sym}-5m-{m}.zip'
        yield f'{SOURCE}/monthly/klines/{sym}/5m/{z}'
    for i in range(1,19):
        z=f'{sym}-5m-2026-11-{i:02d}.zip'
        yield f'{SOURCE}/daily/klines/{sym}/5m/{z}'
def one(task):
    sym,url=task
    for i in range(4):
        try:
            response=requests.get(url,timeout=(15,120));response.raise_for_status()
            blob=response.content
            digest=hashlib.sha256(blob).hexdigest()
            checksum=requests.get(url+'.CHECKSUM',timeout=(15,40))
            checksum.raise_for_status()
            expected=checksum.text.split()[0].lower()
            if expected!=digest:raise ValueError('SHA-256 NO COINCIDE')
            with zipfile.ZipFile(io.BytesIO(blob)) as z:
                files=[n for n in z.namelist() if n.endswith('.csv')]
                if len(files)!=1:raise ValueError('Archivos CSV inesperados')
                with z.open(files[0]) as f:
                    df=pd.read_csv(f,header=None,names=NAMES,low_memory=False)
            for c in ['open_ts','open','high','low','close','volume','quote_volume','trades']:
                df[c]=pd.to_numeric(df[c],errors='coerce')
            df['ts']=pd.to_datetime(df.open_ts,unit='us',utc=True,errors='coerce')
            df=df.dropna(subset=['ts','open','high','low','close','volume'])
            df=df[['ts','open','high','low','close','volume','quote_volume','trades']]
            return (sym,df,{'symbol':sym,'url':url,'sha256':digest,'rows':len(df),'status':'OK'})
        except Exception as exc:
            if i==3:return (sym,None,{'symbol':sym,'url':url,'sha256':'','rows':0,'status':str(exc)})
            time.sleep(2**i)
def rma(series,period=14):
    return series.ewm(alpha=1/period,adjust=False,min_periods=period).mean()
def enrich(df,m):
    z=df.copy()
    close=z.close;delta=close.diff()
    z['available_at_utc']=z.index+pd.Timedelta(minutes=m)
    z['ema20']=close.ewm(span=20,min_periods=20,adjust=False).mean()
    z['ema50']=close.ewm(span=50,min_periods=50,adjust=False).mean()
    up=rma(delta.clip(lower=0));down=rma(-delta.clip(upper=0))
    z['rsi14']=100-100/(1+up/down.replace(0,np.nan))
    z.loc[(down==0)&(up>0),'rsi14']=100
    z.loc[(down==0)&(up==0),'rsi14']=50
    prv=close.shift()
    true_range=pd.concat([(z.high-z.low),(z.high-prv).abs(),(z.low-prv).abs()],axis=1).max(axis=1)
    z['atr14']=rma(true_range)
    plus=z.high.diff();minus=-z.low.diff()
    plusdm=plus.where((plus>minus)&(plus>0),0)
    minusdm=minus.where((minus>plus)&(minus>0),0)
    pdi=100*rma(plusdm)/z.atr14.replace(0,np.nan)
    mdi=100*rma(minusdm)/z.atr14.replace(0,np.nan)
    z['adx14']=rma(100*(pdi-mdi).abs()/(pdi+mdi).replace(0,np.nan))
    middle=close.rolling(20,min_periods=20).mean()
    dev=close.rolling(20,min_periods=20).std(ddof=0)
    z['bb_middle']=middle
    z['bb_upper']=middle+2*dev
    z['bb_lower']=middle-2*dev
    z['bb_width_pct']=100*(z.bb_upper-z.bb_lower)/middle
    z['donchian20_prior_high']=z.high.rolling(20,min_periods=20).max().shift(1)
    z['donchian20_prior_low']=z.low.rolling(20,min_periods=20).min().shift(1)
    z['volume_ratio20']=z.volume/z.volume.rolling(20,min_periods=20).mean().shift(1)
    fast=close.ewm(span=12,adjust=False,min_periods=12).mean()
    slow=close.ewm(span=26,adjust=False,min_periods=26).mean()
    z['macd']=fast-slow
    z['macd_signal']=z.macd.ewm(span=9,adjust=False,min_periods=9).mean()
    z['macd_hist']=z.macd-z.macd_signal
    z['momentum3_pct']=100*(close/close.shift(3)-1)
    z['momentum6_pct']=100*(close/close.shift(6)-1)
    if m==60:
        z['momentum24h_pct']=100*(close/close.shift(24)-1)
        z['momentum72h_pct']=100*(close/close.shift(72)-1)
        z['volatility24h_pct']=100*close.pct_change().rolling(24,min_periods=24).std()*np.sqrt(24)
        z['relative_score']=(z.momentum24h_pct+z.momentum72h_pct)/2/z.volatility24h_pct.replace(0,np.nan)
    return z
def bars(source,m):
    if m==5:return source
    a=source.resample(f'{m}min',label='left',closed='left').agg(
      {'open':'first','high':'max','low':'min','close':'last','volume':'sum',
       'quote_volume':'sum','trades':'sum'})
    full=source.close.resample(f'{m}min',label='left',closed='left').count()==m//5
    return a[full].dropna(subset=['open','high','low','close'])
def main():
    tasks=[(p,url) for p in PAIRS for url in links(p)]
    print('Archivos esperados:',len(tasks),flush=True)
    results=[]
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        for obj in concurrent.futures.as_completed([pool.submit(one,t) for t in tasks]):
            item=obj.result()
            print(item[2]['status'][:100],item[2]['url'],flush=True)
            results.append(item)
    manifest=[x[2] for x in results]
    pd.DataFrame(manifest).sort_values(['symbol','url']).to_csv(OUT/'fuentes_sha256.csv',index=False)
    report={'generated_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),
       'venue':'Binance Spot','quote':'USDT (NO USD Kraken ni Revolut X)',
       'warmup_utc':'2026-07-01','eval_start_utc':'2026-08-01',
       'end_exclusive_utc':'2026-11-19','sources_expected':110,
       'sources_ok':sum(m['status']=='OK' for m in manifest),
       'missing_sources':[m['url'] for m in manifest if m['status']!='OK'],
       'coverage':[]}
    hourly=[]
    for sym in PAIRS:
        sources=[x[1] for x in results if x[0]==sym and x[1] is not None]
        if not sources:continue
        s=pd.concat(sources,ignore_index=True).drop_duplicates(subset=['ts'],keep='last').sort_values('ts')
        s=s[(s.ts>=BEGIN)&(s.ts<END)].set_index('ts')
        s=s[(s.open>0)&(s.high>=s[['open','close','low']].max(axis=1))&
            (s.low<=s[['open','close','high']].min(axis=1))&(s.volume>=0)]
        expected=pd.date_range(BEGIN,END-pd.Timedelta(minutes=5),freq='5min')
        gaps=expected.difference(s.index)
        pd.DataFrame({'missing_5m_utc':gaps}).to_csv(OUT/f'{sym}_huecos.csv',index=False)
        print(sym,'bars',len(s),'missing',len(gaps),flush=True)
        for minutes,interval in [(5,'5m'),(15,'15m'),(60,'1h'),(240,'4h')]:
            df=enrich(bars(s,minutes),minutes)
            df.to_csv(OUT/f'{sym}_{interval}_indicators.csv.gz',
                      compression='gzip',index_label='open_time_utc',float_format='%.10g')
            report['coverage'].append({'symbol':sym,'interval':interval,'rows':len(df),
                 'from':str(df.index.min()),'to':str(df.index.max()),'missing_source_5m':len(gaps)})
            if minutes==60:hourly.append(df[['available_at_utc','relative_score',
                'momentum24h_pct','momentum72h_pct','volatility24h_pct']].assign(symbol=sym).reset_index(drop=True))
    if hourly:
        cross=pd.concat(hourly,ignore_index=True).dropna(subset=['relative_score'])
        cross['assets_available']=cross.groupby('available_at_utc').symbol.transform('nunique')
        cross['eligible_all5']=cross.assets_available==5
        cross['rank']=cross.groupby('available_at_utc').relative_score.rank(ascending=False,method='first')
        cross.sort_values(['available_at_utc','rank']).to_csv(
           OUT/'FUERZA_RELATIVA_5_ACTIVOS.csv.gz',compression='gzip',index=False)
    (OUT/'VALIDACION.json').write_text(json.dumps(report,indent=2,ensure_ascii=False),encoding='utf-8')
    print('FIN; fuentes correctas:',report['sources_ok'],'/110',flush=True)
if __name__=='__main__':main()
