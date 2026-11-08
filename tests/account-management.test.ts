import test from "node:test";
import assert from "node:assert/strict";
import { accountAccessError, emptyState, executeCommand, visibleState } from "../src/lib/domain";
import { validateNewPassword, accountRoleLabel } from "../src/lib/account-policy";
import type { User } from "../src/lib/types";

const account=(id:string,role:User["role"],extra:Partial<User>={}):User=>({id,name:id,email:`${id}@test.local`,username:id,role,active:true,target:0,...extra});
const fixture=()=>({...emptyState(),users:[account("owner","admin",{is_superadmin:true}),account("admin","admin"),account("employee","employee"),account("pending","employee",{active:false,registration_status:"pending"})]});
const password="NewSecurePassword42";

test("password validation preserves whitespace and enforces exact confirmation and bcrypt length",()=>{
  assert.equal(validateNewPassword(` ${password} `,` ${password} `),` ${password} `);
  for (const bad of [null,"short","x".repeat(73),"é".repeat(37),"abcdef\0ghijklmn"])
    assert.throws(()=>validateNewPassword(bad,bad),/Kata sandi/);
  assert.throws(()=>validateNewPassword(password,password+" "),/Konfirmasi/);
});

test("admin may update another admin and promote approved employees with an auditable transition",()=>{
  const source=fixture();
  const edited=executeCommand(source,"admin","user.update",{id:"owner",email:"owner.new@test.local",username:"owner.new",name:"Amalia Safira"});
  assert.equal(edited.users[0].email,"owner.new@test.local");
  assert.equal(edited.users[0].is_superadmin,true);
  const promoted=executeCommand(edited,"admin","user.update",{id:"employee",role:"admin"});
  assert.equal(promoted.users[2].role,"admin");
  assert.equal((promoted.activity[0].before as User).role,"employee");
  assert.equal((promoted.activity[0].after as User).role,"admin");
  assert.throws(()=>executeCommand(source,"employee","user.update",{id:"employee",role:"admin"}),/admin/);
  assert.throws(()=>executeCommand(source,"admin","user.update",{id:"pending",role:"admin"}),/pendaftaran/);
  assert.throws(()=>executeCommand(source,"admin","user.update",{id:"employee",is_superadmin:true}),/tidak dapat diubah/);
});

test("superadmin cannot be demoted, disabled, deleted, or have password changed even by self",()=>{
  const source=fixture();
  assert.equal(accountRoleLabel(source.users[0]),"Superadmin");
  for(const actor of ["owner","admin"]){
    for(const payload of [{role:"employee"},{active:false},{password,password_confirmation:password}])
      assert.throws(()=>executeCommand(source,actor,"user.update",{id:"owner",...payload}),/superadmin|Superadmin/);
    assert.throws(()=>executeCommand(source,actor,"user.delete",{id:"owner",reason:"Test reason"}),/karyawan/);
  }
  assert.throws(()=>executeCommand(source,"owner","profile.password",{current_password:password,new_password:password,password_confirmation:password}),/superadmin/);
});

test("password actions audit only metadata and reject missing or unequal confirmations",()=>{
  const source=fixture();
  const reset=executeCommand(source,"admin","user.update",{id:"employee",password,password_confirmation:password});
  assert.equal((reset.activity[0].after as {password_changed:boolean}).password_changed,true);
  assert.equal(JSON.stringify(reset).includes(password),false);
  const self=executeCommand(source,"employee","profile.password",{current_password:"OldSecretPassword",new_password:password,password_confirmation:password});
  assert.equal(self.activity[0].action,"profile.password");
  assert.equal(JSON.stringify(self).includes("OldSecretPassword"),false);
  assert.equal(JSON.stringify(self).includes(password),false);
  assert.throws(()=>executeCommand(source,"admin","user.update",{id:"employee",password}),/Konfirmasi/);
  assert.throws(()=>executeCommand(source,"employee","profile.password",{current_password:"",new_password:password,password_confirmation:password}),/saat ini/);
});

test("demotion immediately scopes state and the final active admin stays protected",()=>{
  const state=executeCommand(fixture(),"admin","user.update",{id:"admin",role:"employee"});
  assert.equal(visibleState(state,state.users[1]).users.length,1);
  assert.equal(visibleState(state,state.users[1]).activity.length,0);
  const sole={...emptyState(),users:[account("admin","admin")]};
  assert.throws(()=>executeCommand(sole,"admin","user.update",{id:"admin",role:"employee"}),/atasan/);
});

test("employee deletion preserves attribution and audit history but blocks login and edits",()=>{
  const source=fixture();
  source.activity.push({id:"old",user_id:"employee",action:"auth.login",description:"Existing history",created_at:"2026-10-01T01:00:00Z"});
  const state=executeCommand(source,"admin","user.delete",{id:"employee",reason:"Sudah tidak bekerja"});
  const deleted=state.users[2];
  assert.equal(deleted.name,"employee");assert.equal(deleted.active,false);assert.ok(deleted.deleted_at);
  assert.match(accountAccessError(deleted)!,/dihapus/);
  assert.equal(state.activity[0].action,"user.delete");assert.equal(state.activity[1].id,"old");
  assert.throws(()=>executeCommand(state,"admin","user.update",{id:"employee",active:true}),/dihapus/);
  assert.throws(()=>executeCommand(state,"admin","user.approve",{id:"employee"}),/dihapus/);
  assert.throws(()=>executeCommand(source,"admin","user.delete",{id:"employee",reason:""}),/Alasan/);
  assert.throws(()=>executeCommand(source,"employee","user.delete",{id:"pending",reason:"Reason"}),/admin/);
});

test("employee holding unsold eggs cannot be deleted",()=>{
  const source=fixture();
  source.pickups.push({id:"take",user_id:"employee",date:"2026-10-01",category:"good",eggs:10,kg:1,trays:0,returned_eggs:0,returned_kg:0,returned_trays:0,area:"Pasar",notes:"",locked:false,created_at:"2026-10-01T01:00:00Z"});
  assert.throws(()=>executeCommand(source,"admin","user.delete",{id:"employee",reason:"Resign"}),/masih dibawa/);
});
