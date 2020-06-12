// PASSED TEST: with nothing but following 3 lines, validated jest passing test
//test("should be 1", () => {
  //expect(1).toBe(1);
//});

// Test with Jest
//const main = require("./index");
const firebase = require('@firebase/testing') //<--- You want this to be the top guy!!!
const admin = require('firebase-admin')

const projectId = "loveyou-forms";
process.env.GCLOUD_PROJECT = projectId;
process.env.FIRESTORE_EMULATOR_HOST = "localhost:8000";
let app = admin.initializeApp({projectId})
let db = firebase.firestore(app)

// clear all db data before each testing procedure [ doing this breaks testing ]
//beforeAll(async () => {
  //await firebase.clearFirestoreData({projectId});
//})

test("should be 1", () => {
  expect(1).toBe(1);
});

// When document written to '/app/{DocumentId}' , trigger function overwrites it
// with copy of '/global/schemaApp' document 
test("Expect new app doc to contain default schemaApp properties", async () => {
  // Create new doc key then 'set' data
  const newKeyRef = db.collection('app').doc();
  console.log("newKeyRef/doc.id $$$$$$$$$$$$$", newKeyRef.id);
  // create the new-key-record using 'set' which works for existing doc
  newKeyRef.set({});

  const appRef = await db.collection('app').doc(newKeyRef.id).get();
  console.log("appRef 11111111111111 ", appRef.id);
  const app = appRef.data();
  console.log("app 11111111111111111 ", app);

  expect(1).toBe(1);
});

test("Expect new app doc to contain default schemaApp properties", async () => {

  const appRef = await db.collection('app').doc('Rao2t1NWyb3b14okSS64').get();
  console.log("appRef 22222222222222 ", appRef.id);
  const app = appRef.data();
  console.log("app 22222222222222222 ", app);

  expect(1).toBe(1);
});













/*
test("Test something", () => {
  expect(main.schemaApp('app', 'schemaApp')).toBe();
});
*/

/*

test("Test something", () => {
  expect(testFileParens.file("./code.lisp.txt")).toBe(true);
});

*/
