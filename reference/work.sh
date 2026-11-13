#!/bin/sh
# work.sh <id> working|done : mark a note in notes.json
python3 - "$(dirname "$0")/notes.json" "$1" "$2" <<'PY'
import json,sys
F,*a=sys.argv[1:]
n=json.load(open(F))
for x in n:
    if x['id']==a[0]:
        if a[1]=='working': x['working']=True
        else: x['done']=True; x.pop('working',None)
json.dump(n,open(F,'w'),indent=2,ensure_ascii=False)
PY
