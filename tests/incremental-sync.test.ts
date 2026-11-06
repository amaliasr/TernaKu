import test from "node:test";
import assert from "node:assert/strict";
import { activePrice, emptyState, pickupBalance } from "../src/lib/domain";
import { isPriceSyncResponse, mergePriceSync } from "../src/lib/price-sync";
import { isReceiptDelta, mergeReceiptDelta } from "../src/lib/receipt-delta";
import type { PriceSyncResponse, Price, Notification, Sale, Pickup } from "../src/lib/types";

const user = { id: "sari", role: "employee" as const, name: "Sari", active: true, email: "sari@test.local", target: 0 };
const price = (id: string, date: string, good_price=28_000): Price => ({id, effective_at:date, created_at:date, good_price, cracked_price:18_000, created_by:"admin"});
const notice = (id: string, read=false): Notification => ({id, user_id:user.id, title:"Harga", message:"Pembaruan harga", read, created_at:"2026-10-01"});
const snapshot: PriceSyncResponse = { mode:"delta", since:"12", cursor:"15", more:false, prices:[], notifications:[], read_notices:[], settings:{harvest_auto_stock:true}, user };

test("cursor merge keeps scheduled prices, identical nominal updates and correct read flags", () => {
  const state=emptyState(); state.users=[user]; state.price_cursor="12";
  state.prices=[price("p1","2026-10-01T08:00:00+07:00")]; state.notifications=[notice("old")];
  const newer=price("p2","2026-10-10T08:00:00+07:00");
  const merged=mergePriceSync(state,{...snapshot,prices:[newer],notifications:[notice("after-read-all")],read_notices:["all"]},user.id);
  assert.equal(activePrice(merged,new Date("2026-10-09T10:00:00Z"))?.id,"p1");
  assert.equal(activePrice(merged,new Date("2026-10-10T10:00:00Z"))?.id,"p2");
  assert.equal(merged.notifications.find(n=>n.id==="old")?.read,true);
  assert.equal(merged.notifications.find(n=>n.id==="after-read-all")?.read,false);
  assert.equal(merged.price_cursor,"15"); assert.equal(merged.sales,state.sales);
  assert.throws(()=>mergePriceSync(merged,snapshot,user.id),/Pembaruan harga/);
  assert.throws(()=>mergePriceSync(state,{...snapshot,notifications:[{...notice("foreign"),user_id:"other"}]},user.id),/Pembaruan harga/);
});
test("unchanged poll preserves collections; a truncated/malformed cursor cannot loop or erase state", () => {
  const state=emptyState(); state.users=[user]; state.price_cursor="12";
  const noop={...snapshot,cursor:"12"}; assert.equal(isPriceSyncResponse(noop),true);
  const merged=mergePriceSync(state,noop,user.id); assert.equal(merged.prices,state.prices); assert.equal(merged.notifications,state.notifications);
  for(const broken of [{more:true}, {cursor:"11"}, {cursor:"not-an-id"}, {mode:"other"}, {read_notices:[12]}])
    assert.equal(isPriceSyncResponse({...noop,...broken}),false);
});

test("receipt delta always resolves the exact invoice, including on replay after sale from another phone", () => {
  const state=emptyState(); state.users=[user]; state.inventory={good:{eggs:65,kg:3.9,trays:0},cracked:{eggs:0,kg:0,trays:0}};
  const pickup:Pickup={id:"pu",date:"2026-10-01",user_id:user.id,category:"good",eggs:100,kg:6,trays:0,area:"Pasar",notes:"",created_at:"2026-10-01",locked:false,returned_eggs:0,returned_kg:0,returned_trays:0};
  const sale:Sale={id:"sale1",number:"TK-1",user_id:user.id,date:"2026-10-01",notes:"",customer:"Warung",phone:"",created_at:"2026-10-01",
    total:16800,paid:16800,balance:0,payment_method:"cash",payment_status:"paid",locked:true,
    items:[{id:"i1",pickup_id:"pu",category:"good",eggs:10,kg:0.6,trays:0,unit_price:28000,total:16800}]};
  const payload={mode:"sale_receipt",sale,pickups:[pickup],pickup_balances:{pu:{eggs:80,kg:4.8,trays:0,status:"Sebagian terjual"}},command_result:{action:"sale.create",request_id:"req12345",record_id:"sale1"}};
  assert.ok(isReceiptDelta(payload,user.id,"req12345"));
  const merged=mergeReceiptDelta(state,payload);
  assert.equal(merged.sales[0].id,"sale1"); assert.equal(merged.inventory,state.inventory);
  assert.equal(pickupBalance(merged,"pu").eggs,80); // includes another sale not yet in our history
  assert.equal(mergeReceiptDelta(merged,payload).sales.length,1);
  assert.deepEqual(mergeReceiptDelta({...merged,sales:[{...sale,id:"later-sale"},sale]},payload).sales.map(s=>s.id),["later-sale","sale1"]);
  assert.equal(isReceiptDelta(payload,"other","req12345"),false);
  assert.equal(isReceiptDelta(payload,user.id,"otherReq"),false);
  assert.equal(isReceiptDelta({...payload,pickups:[{...pickup,user_id:"other"}]},user.id,"req12345"),false);
  assert.equal(isReceiptDelta({...payload,pickup_balances:{}},user.id,"req12345"),false);
  assert.equal(isReceiptDelta({...payload,command_result:{...payload.command_result,record_id:"wrong"}},user.id,"req12345"),false);
});
test("a warehouse receipt updates shared inventory once, never claims a personal pickup, and rejects unrelated movements", () => {
  const state=emptyState(), req="warehouse-1", stamp="2026-11-06T08:00:00Z";
  const sale:Sale={id:"w",number:"TK-W",user_id:user.id,date:stamp,created_at:stamp,notes:"",customer:"Toko",phone:"",
    stock_source:"warehouse",total:0,paid:0,balance:0,payment_method:"cash",payment_status:"paid",locked:true,
    items:[{id:"i",pickup_id:"",category:"cracked",eggs:10,kg:0.5,trays:0,unit_price:0,total:0}]};
  const m={id:"m",kind:"sale",reference_id:"w",user_id:user.id,category:"cracked",date:stamp,created_at:stamp,notes:"TK-W",eggs:-10,kg:-0.5,trays:0};
  const inventory={good:{eggs:120,kg:7,trays:2},cracked:{eggs:5,kg:0.25,trays:0}};
  const receipt={mode:"sale_receipt",command_result:{action:"sale.create",record_id:sale.id,request_id:req},sale,pickups:[],pickup_balances:{},inventory,stock_movements:[m]};
  assert.ok(isReceiptDelta(receipt,user.id,req));
  const once=mergeReceiptDelta(state,receipt);
  assert.deepEqual(once.inventory,inventory);
  assert.deepEqual(once.stock_movements,[m]);
  assert.deepEqual(once.pickups,state.pickups);
  assert.deepEqual(mergeReceiptDelta(once,receipt),once);
  for (const bad of [{stock_movements:[]}, {stock_movements:[m,m]}, {stock_movements:[{...m,reference_id:"other"}]},
    {stock_movements:[{...m,user_id:"other"}]}, {pickup_balances:{fake:{}}}, {inventory:{...inventory,cracked:{eggs:-1,kg:0,trays:0}}}])
    assert.equal(isReceiptDelta({...receipt,...bad},user.id,req),false);
});
