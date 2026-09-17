const {test}=require('node:test');
const assert=require('node:assert/strict');
const {load,silent}=require('./helpers.cjs');
const Analyser=load('src/core/PageAnalyser.js',{'../../utils/Logger':silent});
const analyse=new Analyser({});
const empty=()=>({inputs:[],buttons:[],links:[],selects:[]});
for(const [type,value] of [['text','test_value'],['email','test@example.test'],['number','1'],['date','2026-01-01'],['time','12:00'],['datetime-local','2026-01-01T12:00'],['month','2026-01'],['week','2026-W01'],['url','https://example.test'],['tel','1234567890'],['password','test_value']]) {
 test(`generated ${type} field gets a compatible value`,()=>{const plan=empty();plan.inputs=[{type,selector:'#field'}];assert.equal(analyse.generateActions(plan)[0].value,value);});
}
test('selects precede submission and navigation actions',()=>{const plan=empty();plan.inputs=[{selector:'#name'}];plan.buttons=[{selector:'#submit',text:'Submit'}];plan.selects=[{selector:'#country',options:['it']}];plan.links=[{selector:'#next'}];assert.deepEqual(analyse.generateActions(plan).map(x=>x.action),['type','select','click','click']);});
test('empty selects and selects with no options yield no action',()=>{const plan=empty();plan.selects=[{selector:'#empty',options:[]},{selector:'#none'}];assert.deepEqual(analyse.generateActions(plan),[]);});
test('select can use an empty option when it is the only enabled option',()=>{const plan=empty();plan.selects=[{selector:'#select',options:['']}];assert.equal(analyse.generateActions(plan)[0].value,'');});
test('test generator delegates once and retains current page URL',async()=>{
 let analyzed=0,generated=0;const data={allElements:[1]};const scenarios=[{action:'click',locator:'#go'}];
 const Generator=load('src/core/TestGenerator.js',{'../../utils/Logger':silent,'./PageAnalyser':class{async analyze(){analyzed++;return data;}generateActions(received){assert.equal(received,data);generated++;return scenarios;}}});
 assert.deepEqual(await new Generator({url:()=> 'http://fixture.test/page'}).generateTestScenarios(),{url:'http://fixture.test/page',test_scenarios:scenarios});assert.equal(analyzed,1);assert.equal(generated,1);
});
