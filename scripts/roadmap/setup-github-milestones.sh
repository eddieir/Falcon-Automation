#!/usr/bin/env bash
# Set up Falcon roadmap milestones and attach existing GitHub issues.
# Requires: gh (authenticated), python3. Idempotent; never deletes milestones.
set -euo pipefail
REPO="eddieir/Falcon-Automation"
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
gh auth status >/dev/null
python3 - <<'PY'
import datetime,json,subprocess,pathlib,urllib.parse,sys
repo="eddieir/Falcon-Automation"
rows=[["M0","Competitive evidence baseline","2026-11-13",74,76],["M1","Trustworthy Alpha","2027-01-08",77,79],["M2","Secure Technical Preview","2027-02-19",80,82],["M3","Verified Self-Healing","2027-03-26",83,85],["M4","Developer Beta","2027-05-07",86,88],["M5","Efficient CI","2027-06-18",89,91],["M6","Enterprise Operations","2027-08-13",92,95],["M7","Customer Pilot","2027-09-24",96,98],["M8","Advanced QA","2027-12-03",99,101],["M9","Independent Competitive Release","2028-01-14",102,104]]
def gh(method,path,**data):
    cmd=["gh","api","--method",method,path]
    for k,v in data.items(): cmd+=["-f",f"{k}={v}"]
    p=subprocess.run(cmd,text=True,capture_output=True)
    if p.returncode: raise RuntimeError(f"GitHub API {method} {path} failed: {p.stderr.strip()}")
    return json.loads(p.stdout) if p.stdout.strip() else {}
# Fetch all milestone pages to safely reuse existing exact titles.
existing=[]
page=1
while True:
    batch=gh("GET",f"repos/{repo}/milestones?state=all&per_page=100&page={page}")
    existing+=batch
    if len(batch)<100:break
    page+=1
links=[]
for key,name,due,first,last in rows:
    title=f"{key} — {name}"
    matches=[m for m in existing if m["title"]==title]
    if len(matches)>1:raise RuntimeError(f"Ambiguous duplicate milestones: {title}")
    if matches:
        m=matches[0]
        if m["state"]!="open": raise RuntimeError(f"Milestone {title} exists but is closed; manual review required")
        # Do not overwrite owner-customized existing dates or descriptions.
        print(f"REUSE {title}: {m['html_url']}")
    else:
        due_dt=f"{due}T23:59:59Z"
        desc=f"Falcon competitive roadmap {key}. Target date is provisional and depends on preceding quality/security exit gates; not an unconditional release promise."
        m=gh("POST",f"repos/{repo}/milestones",title=title,description=desc,due_on=due_dt)
        existing.append(m)
        print(f"CREATED {title}: {m['html_url']}")
    for issue_num in range(first,last+1):
        issue=gh("GET",f"repos/{repo}/issues/{issue_num}")
        expected=f"[{key}]"
        if not issue["title"].startswith(expected):raise RuntimeError(f"Issue #{issue_num} has unexpected title: {issue['title']}; stop")
        curr=issue.get("milestone")
        if curr is not None and curr["number"]!=m["number"]:
            raise RuntimeError(f"Issue #{issue_num} already assigned to another milestone: {curr['title']}; stop")
        if curr is None:
            gh("PATCH",f"repos/{repo}/issues/{issue_num}",milestone=str(m["number"]))
            print(f"  ASSIGNED #{issue_num}")
    links.append((key,name,due,m["html_url"],first,last))
lines=["# Falcon — Live GitHub milestone links","",
"Targets are provisional; due dates are planning estimates, not contractual delivery commitments.","",
"| Order | Milestone | Target date (UTC) | Issues |",
"|---|---|---|---|"]
for key,name,due,url,first,last in links:
    lines.append(f"| {key} | [{name}]({url}) | {due} | [#{first}–#{last}](https://github.com/{repo}/issues?q=is%3Aissue+milestone%3A%22{urllib.parse.quote(key+' — '+name)}%22) |")
path=pathlib.Path("docs/FALCON-MILESTONE-LINKS.md")
path.write_text("\n".join(lines)+"\n",encoding="utf-8")
print(f"\nSaved {path}. Review, then commit this file to the documentation PR.")
print(f"Milestones: https://github.com/{repo}/milestones")
PY
