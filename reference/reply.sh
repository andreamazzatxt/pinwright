#!/bin/sh
# reply.sh <id> "<text>" : leave Claude's reply on a note (shows as a "?" pin until answered)
python3 - "$(dirname "$0")/notes.json" "$1" "$2" <<'PY'
import json,sys
F,*a=sys.argv[1:]
n=json.load(open(F))
for x in n:
    if x['id']==a[0]:
        x['reply']=a[1]; x.pop('working',None); x.pop('answer',None)
json.dump(n,open(F,'w'),indent=2,ensure_ascii=False)
PY
