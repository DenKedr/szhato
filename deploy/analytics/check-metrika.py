#!/usr/bin/env python3
"""Release gate for current and future public it-kedr.ru virtual hosts."""
import json,re,subprocess,sys,urllib.request
nginx=subprocess.check_output(['nginx','-T'],stderr=subprocess.STDOUT,text=True)
hosts=set()
for line in nginx.splitlines():
 match=re.match(r'\s*server_name\s+([^;]+);',line)
 if match:
  for host in match.group(1).split():
   if re.fullmatch(r'(?:[a-z0-9-]+\.)*it-kedr\.ru',host):hosts.add(host)
assert 'it-kedr.ru' in hosts,'Main public virtual host missing'
urls={'https://'+host+'/' for host in hosts}
urls.update(sys.argv[1:])
urls.update(['https://it-kedr.ru/soft/','https://it-kedr.ru/forum/','https://project.it-kedr.ru/compressed','https://project.it-kedr.ru/compressed?tool=convert'])
checked=[]
for url in sorted(urls):
 with urllib.request.urlopen(url,timeout=20) as response:
  assert response.status==200,(url,response.status)
  assert response.headers.get_content_type()=='text/html',(url,'not HTML')
  html=response.read().decode('utf-8')
 assert html.count('src="/_analytics/metrika-113884564.js"')==1,(url,'counter bootstrap missing/duplicated')
 assert html.count('src="https://mc.yandex.ru/watch/113884564"')==1,(url,'noscript pixel missing/duplicated')
 checked.append(url)
for host in hosts:
 with urllib.request.urlopen('https://'+host+'/_analytics/metrika-113884564.js',timeout=20) as response:
  assert response.status==200 and response.headers.get_content_type() in ('application/javascript','text/javascript'),host
  assert 'webvisor:true' in response.read().decode(),host
print(json.dumps({'counter':113884564,'virtual_hosts':sorted(hosts),'checked_pages':checked,'result':'PASS'},ensure_ascii=False))
