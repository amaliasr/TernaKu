import test from "node:test";
import assert from "node:assert/strict";
import { readPendingRequestIds, rememberCommandRequest } from "../src/lib/request-retries";

test("retry IDs survive parsing and serialization unchanged", () => {
  const fingerprint = `user-1:${"a".repeat(64)}`;
  const requestId = "005e8767-d530-4532-83ea-d55463e299d6";
  const raw = JSON.stringify({ [fingerprint]: requestId });
  const retries = readPendingRequestIds(raw);
  assert.equal(retries[fingerprint], requestId);
  assert.equal(JSON.stringify(retries), raw);
  assert.deepEqual(readPendingRequestIds(null), {});
  assert.deepEqual(readPendingRequestIds("{}"), {});
});

test("damaged maps fail closed instead of dropping the next request ID", () => {
  for (const raw of ["[]", "[1]", "null", '"text"', "123", "true", "", "{broken"]) {
    assert.throws(() => readPendingRequestIds(raw), /Hubungi admin/);
  }
});

test("invalid stored IDs cannot be replaced silently before retrying a write", () => {
  for (const id of [null, 123, {}, [], "", "short", "a".repeat(81), "id with spaces"]) {
    assert.throws(
      () => readPendingRequestIds(JSON.stringify({ fingerprint: id })),
      /Hubungi admin/,
    );
  }
});

test("password retries reuse one ID in memory without reading or writing persistent storage", () => {
  const memory=new Map<string,string>();
  const storage={getItem:()=>{throw new Error("Persistent reads forbidden");},setItem:()=>{throw new Error("Persistent writes forbidden");}};
  let sequence=0;const createId=()=>`request-${++sequence}`;
  const first=rememberCommandRequest("secret-derived-digest",true,memory,storage,"broken-retries",createId);
  assert.equal(rememberCommandRequest("secret-derived-digest",true,memory,storage,"broken-retries",createId),first);
  assert.equal(sequence,1);
  memory.clear();
  assert.notEqual(rememberCommandRequest("secret-derived-digest",true,memory,storage,"broken-retries",createId),first);
});

test("ordinary writes retain durable retry IDs and still fail closed on damaged storage", () => {
  let raw:string|null=null;
  const storage={getItem:()=>raw,setItem:(_key:string,value:string)=>{raw=value;}};
  const first=rememberCommandRequest("stock-change",false,new Map(),storage,"retry-map",()=>"request-ordinary-1");
  assert.equal(rememberCommandRequest("stock-change",false,new Map(),storage,"retry-map",()=>"request-unused-2"),first);
  raw="invalid-json";
  assert.throws(()=>rememberCommandRequest("stock-change",false,new Map(),storage,"retry-map",()=>"request-unused-3"),/Hubungi admin/);
});
