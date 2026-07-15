import json
from pathlib import Path

def load(path):
    try:
        return json.loads(Path(path).read_text(encoding='utf-8'))
    except Exception as e:
        return {'__error': str(e)}

status = load('/tmp/status.json')
audit = load('/tmp/audit.json')
diagnose = load('/tmp/diagnose.json')
export = load('/tmp/export.json')

print('=== STATUS ===')
print(json.dumps({
    'mode': status.get('mode'),
    'isActive': status.get('isActive'),
    'isRunning': status.get('isRunning'),
    'activeRangeVersionId': status.get('activeRangeVersionId'),
    'realOpenOrdersCount': status.get('realOpenOrdersCount'),
    'openCycles': status.get('openCycles'),
    'activeOpenCyclesCount': status.get('activeOpenCyclesCount'),
    'orphanOpenCyclesCount': status.get('orphanOpenCyclesCount'),
    'circuitBreakerOpen': status.get('circuitBreakerOpen'),
}, indent=2))

print('\n=== AUDIT top ===')
print('keys:', list(audit.keys()) if isinstance(audit, dict) else type(audit))
print('mode:', audit.get('mode') if isinstance(audit, dict) else None)
if isinstance(audit, dict) and audit.get('error'):
    print('error:', audit['error'])
print('\n=== AUDIT counters ===')
print(json.dumps(audit.get('counters') or {}, indent=2))

print('\n=== DIAGNOSE ===')
print(json.dumps({
    'mode': diagnose.get('mode'),
    'readOnly': diagnose.get('readOnly'),
    'realOrdersAffected': diagnose.get('realOrdersAffected'),
    'source': diagnose.get('source'),
    'cyclesOrphanCount': diagnose.get('cyclesOrphanCount'),
    'cyclesEligibleForSimulatedClose': diagnose.get('cyclesEligibleForSimulatedClose'),
    'currentPrice': diagnose.get('currentPrice'),
    'cyclesCount': len(diagnose.get('orphanCycles') or []),
}, indent=2))

print('\n=== EXPORT ===')
print(json.dumps({
    'mode': export.get('mode'),
    'cyclesCount': len(export.get('cycles') or []),
    'openCyclesCount': len([c for c in (export.get('cycles') or []) if c.get('status') in ('open','active','buy_filled','buy_placed','sell_placed','cycle_open')]),
}, indent=2))

print('\n=== COHERENCE CHECKS ===')
checks = []
def ok(cond, msg):
    checks.append(('OK' if cond else 'FAIL') + ': ' + msg)

ok(status.get('mode') == 'SHADOW', 'status mode is SHADOW')
ok(status.get('realOpenOrdersCount') == 0, 'status realOpenOrdersCount is 0')
ok(audit.get('mode') == status.get('mode'), 'audit mode matches status mode')
ok(export.get('mode') == status.get('mode'), 'export mode matches status mode')
ok(diagnose.get('mode') == status.get('mode'), 'diagnose mode matches status mode')
ok(diagnose.get('readOnly') is True, 'diagnose readOnly is true')
ok(diagnose.get('realOrdersAffected') is False, 'diagnose realOrdersAffected is false')
ok(status.get('orphanOpenCyclesCount') == diagnose.get('cyclesOrphanCount'), 'status orphan count matches diagnose')
ok(status.get('activeOpenCyclesCount') == 0, 'no active executable cycles')
for c in checks:
    print(c)
