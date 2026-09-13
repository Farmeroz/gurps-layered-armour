import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Handlebars from 'handlebars';
import {parseHTML} from 'linkedom';
import {createEditorClass} from '../scripts/editor.mjs';
import {createMenus, actorForRow, tokenFor} from '../scripts/menus.mjs';
import {emptyProfile, newLayer, ID} from '../scripts/core.mjs';
Handlebars.registerHelper('checked', value => value ? 'checked' : '');
Handlebars.registerHelper('disabled', value => value ? 'disabled' : '');
const template=Handlebars.compile(fs.readFileSync(new URL('../templates/editor.hbs',import.meta.url),'utf8'));
globalThis.foundry={utils:{mergeObject:(a,b)=>({...a,...b})}};
globalThis.game={user:{isGM:false},actors:new Map()};
globalThis.ui={notifications:{info(){},error(){}}};
class Base {
  static get defaultOptions(){return {};}
  constructor(){this.options=this.constructor.defaultOptions;}
  render(){this.renders=(this.renders??0)+1;return this;}
  activateListeners(){}
  async close(){this.closed=true;}
}
const Editor=createEditorClass(Base);
function actor(id='a') {
  let stored=emptyProfile(), writes=0;
  return {id,uuid:`Actor.${id}`,name:'Ada <script>alert(1)</script>',isOwner:true,
    system:{hitlocations:{a:{where:'Torso',dr:'4/2',split:{cr:2}},b:{where:'Skull',dr:'2'}}},
    getFlag:()=>structuredClone(stored),setFlag:async(scope,key,value)=>{assert.equal(scope,ID);assert.equal(key,'profile');stored=structuredClone(value);writes++;},
    setStored(value){stored=structuredClone(value);}, get writes(){return writes;}};
}
function form(editor) {
  const {document,window}=parseHTML(`<html><body>${template(editor.getData())}</body></html>`);
  // LinkeDOM does not implement the live checked property of form inputs.
  for(const input of document.querySelectorAll('input[type="checkbox"]')) Object.defineProperty(input,'checked',{value:input.hasAttribute('checked'),writable:true});
  const root=document.querySelector('form');editor.activateListeners(root);
  return {root,document,window};
}
const profile=(...layers)=>({schema:1,enabled:true,layers});
test('editor renders imported reference without interpreting slash DR, and escapes actor names',()=>{
  const e=new Editor(actor());const {root}=form(e);
  assert.match(root.textContent,/4\/2/);assert.equal(root.querySelector('script'),null);assert.equal(root.querySelectorAll('.armour-layer').length,0);
});
test('saving persists order, coverage, hardened, flexible and zero split DR; reopen retains all',async()=>{
  const a=actor();a.setStored(profile({...newLayer(['Torso']),name:'Mail',dr:6,split:{cr:0},hardened:2,flexible:true}, {...newLayer(['Skull']),name:'Skin',dr:2,kind:'natural'}));
  const e=new Editor(a);const {root}=form(e);const errors=[];
  root.querySelector('[data-field="dr"]').value='8';
  await e.save(root,error=>errors.push(error));assert.deepEqual(errors,[]);assert.equal(a.writes,1);assert.equal(e.closed,true);
  const reopened=new Editor(a);assert.deepEqual(reopened.draft.layers.map(l=>[l.name,l.dr,l.hardened]),[['Mail',8,2],['Skin',2,0]]);
  assert.equal(reopened.draft.layers[0].split.cr,0);assert.equal(reopened.draft.layers[0].flexible,true);
  assert.equal(reopened.draft.layers[1].locations[0].where,'Skull');
});
test('reorder keeps current unsaved field edits and cancel writes nothing',async()=>{
  const a=actor();a.setStored(profile({...newLayer(['Torso']),name:'Outer'},{...newLayer(['Torso']),name:'Inner'}));
  const e=new Editor(a);const {root,window}=form(e);
  root.querySelector('[data-field="dr"]').value='7';
  root.querySelector('[data-action="down"]').dispatchEvent(new window.Event('click',{bubbles:true}));
  assert.deepEqual(e.draft.layers.map(l=>l.name),['Inner','Outer']);assert.equal(e.draft.layers[1].dr,7);
  await e.close();assert.equal(a.writes,0);
});
test('temporary editor saves only callback data; synthetic actor is labelled',async()=>{
  const a=actor();a.isToken=true;a.token={name:'Clone'};let temp;
  const e=new Editor(a,{temporary:true,profile:profile(newLayer(['Torso'])),onSave:v=>{temp=v;}});const {root}=form(e);
  assert.match(root.textContent,/Unlinked token: Clone/);assert.match(e.title,/unlinked token/);
  await e.save(root,assert.fail);assert.equal(a.writes,0);assert.equal(temp.layers.length,1);
});
test('ownership changes and conflicting saves are rejected without overwrites',async()=>{
  const a=actor(),e=new Editor(a),{root}=form(e),errors=[];
  a.isOwner=false;await e.save(root,error=>errors.push(error));assert.equal(a.writes,0);assert.match(errors.pop(),/permission/);
  a.isOwner=true;a.setStored(profile(newLayer(['Torso'])));await e.save(root,error=>errors.push(error));assert.equal(a.writes,0);assert.match(errors.pop(),/changed since/);
});
test('directory context resolves clicked actor, obeys ownership, avoids duplicate entries',()=>{
  const a=actor('clicked'),b=actor('selected');game.actors=new Map([[a.id,a],[b.id,b]]);
  const {document}=parseHTML('<ul><li data-entry-id="clicked"><span>actor</span></li><li data-entry-id="missing"></li></ul>');
  const clicked=document.querySelector('span'),missing=document.querySelector('[data-entry-id="missing"]');let chosen;
  const menu=createMenus(options=>{chosen=options.actor;});const items=[];menu.actorContext({},items);menu.actorContext({},items);
  assert.equal(items.length,1);assert.equal(actorForRow(clicked),a);assert.equal(items[0].condition(clicked),true);items[0].callback(clicked);assert.equal(chosen,a);
  assert.equal(items[0].condition(missing),false);a.isOwner=false;assert.equal(items[0].condition(clicked),false);
});
test('HUD works for native form and custom HUD without a right column; token actor remains synthetic',()=>{
  const a=actor();a.isToken=true;const token={actor:a,document:{id:'t'}};globalThis.canvas={tokens:{get:id=>id==='t'?token:null}};
  const {document,window}=parseHTML('<form><input><div></div></form>');const root=document.querySelector('form');root[0]=root.querySelector('input');let chosen;
  const menu=createMenus(options=>{chosen=options.token;});menu.hud({object:token},root);menu.hud({object:token},root);
  assert.equal(root.querySelectorAll('.armour-layer-hud').length,1);assert.ok(root.querySelector('.armour-layer-hud-group'));
  root.querySelector('button').dispatchEvent(new window.Event('click',{bubbles:true}));assert.equal(chosen,token);
  const row=document.createElement('li');row.dataset.tokenId='missing';assert.equal(tokenFor({object:token},row),null);
  a.isOwner=false;menu.hud({object:token},root);assert.equal(root.querySelector('.armour-layer-hud'),null);
});

test('coverage changes update summary and override controls without losing unsaved values',async()=>{
  const a=actor();a.setStored(profile(newLayer(['Torso'])));
  const e=new Editor(a),{root,window}=form(e);
  const summary=root.querySelector('[data-coverage-summary]');
  const all=root.querySelector('[data-field="allLocations"]');
  const torso=root.querySelector('[data-location="Torso"]');
  const skull=root.querySelector('[data-location="Skull"]');
  const details=summary.parentElement;details.setAttribute('open','');
  root.querySelector('[data-field="name"]').value='Unsaved armour name';
  root.querySelector('[data-field="split"]').value='cr='; // Editing an incomplete value must still work.
  assert.equal(summary.textContent,'Coverage: Torso');
  assert.equal(skull.querySelector('[data-dr]').disabled,true);
  all.checked=true;all.dispatchEvent(new window.Event('change',{bubbles:true}));
  assert.equal(summary.textContent,'Coverage: Every location');
  assert.equal(root.querySelector('[data-coverage-heading]').textContent,'Override');
  assert.match(root.querySelector('[data-coverage-hint]').textContent,/Every location is covered/);
  assert.equal(skull.querySelector('[data-cover]').checked,false);
  assert.equal(skull.querySelector('[data-cover]').getAttribute('aria-label'),'Override Skull');
  assert.equal(root.querySelector('[data-field="name"]').value,'Unsaved armour name');
  assert.equal(root.querySelector('[data-field="split"]').value,'cr=');
  assert.equal(details.hasAttribute('open'),true);assert.equal(e.renders,undefined);
  all.checked=false;all.dispatchEvent(new window.Event('change',{bubbles:true}));
  skull.querySelector('[data-cover]').checked=true;skull.querySelector('[data-cover]').dispatchEvent(new window.Event('change',{bubbles:true}));
  assert.equal(summary.textContent,'Coverage: Torso, Skull');
  assert.equal(skull.querySelector('[data-dr]').disabled,false);
  for(const row of [torso,skull]) {row.querySelector('[data-cover]').checked=false;row.querySelector('[data-cover]').dispatchEvent(new window.Event('change',{bubbles:true}));}
  assert.equal(summary.textContent,'Coverage: None');assert.equal(a.writes,0);
});

test('file import is staged, retains unmatched locations and persists only on Save',async()=>{
  const {exportSetup}=await import('../scripts/transfer.mjs');
  const a=actor(),e=new Editor(a);let {root}=form(e);
  const imported=profile({...newLayer(['Tail']),name:'Imported suit',dr:17,hardened:3,split:{cr:0}});
  const text=exportSetup(imported);
  root.querySelector('[data-import-file]').files=[{size:text.length,text:async()=>text}];
  await e.importFile(root,assert.fail);
  assert.equal(a.writes,0);assert.equal(e.draft.layers[0].dr,17);assert.ok(e.locations.includes('Tail'));
  assert.deepEqual(e.getData().unmatched,['Tail']);assert.match(e.getData().importNotice,/Review/);
  ({root}=form(e));assert.match(root.textContent,/these names do not match/);
  assert.ok(root.querySelector('[data-location="Tail"]'));
  await e.save(root,assert.fail);assert.equal(a.writes,1);assert.deepEqual(new Editor(a).draft,imported);
});
test('cancel after import and invalid files preserve the saved actor and existing editor values',async()=>{
  const {exportSetup}=await import('../scripts/transfer.mjs');
  const a=actor();a.setStored(profile({...newLayer(['Torso']),dr:7}));const e=new Editor(a),{root}=form(e),errors=[];
  root.querySelector('[data-field="name"]').value='Unsaved edit';
  const field=root.querySelector('[data-import-file]');
  field.files=[{size:1,text:async()=>'{'}];await e.importFile(root,m=>errors.push(m));
  assert.match(errors.pop(),/valid JSON/);assert.equal(root.querySelector('[data-field="name"]').value,'Unsaved edit');
  assert.equal(e.draft.layers[0].dr,7);assert.equal(a.writes,0);assert.equal(field.disabled,false);
  const text=exportSetup(profile({...newLayer(['Torso']),dr:22}));field.files=[{size:text.length,text:async()=>text}];
  await e.importFile(root,assert.fail);await e.close();assert.equal(a.writes,0);assert.equal(new Editor(a).draft.layers[0].dr,7);
});
test('import rechecks permissions and preserves save conflict protection',async()=>{
  const {exportSetup}=await import('../scripts/transfer.mjs');
  const a=actor(),e=new Editor(a),{root}=form(e),errors=[];
  const text=exportSetup(profile(newLayer(['Torso'])));
  const field=root.querySelector('[data-import-file]');field.files=[{size:text.length,text:async()=>{a.isOwner=false;return text;}}];
  await e.importFile(root,m=>errors.push(m));assert.match(errors.pop(),/permission/);assert.equal(e.draft.layers.length,0);
  a.isOwner=true;field.files=[{size:text.length,text:async()=>text}];await e.importFile(root,assert.fail);
  a.setStored(profile({...newLayer(['Torso']),dr:50}));await e.save(form(e).root,m=>errors.push(m));
  assert.match(errors.pop(),/changed since/);assert.equal(a.writes,0);
});
