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

// Prop Check
const propCheck = (obj, l1, l2, l3) => {
  return (
    l3 ? obj[l1][l2].hasOwnProperty(l3) ? true : false :
    l2 ? obj[l1].hasOwnProperty(l2) ? true : false :
    obj.hasOwnProperty(l1) ? true : false
  )
}

// When Document written to '/app/{DocumentId}', a trigger function overwrites
// it with the document copied from '/global/schemaApp'
test("Expect new '/app/{DocumentId}' === '/global/schemaApp' doc", async () => {

  // 1) Get copy of /global/schemaApp
  const schemaRef = await db.collection('global').doc('schemaApp').get();
  const schemaRefData = schemaRef.data();

  // 2) Create new doc with single-level prop by hardcoding the object since 
  // that's how someone would add a new app to the database 
  const newIdRef = db.collection('app').doc(); // First create new doc id (so we know the id) then 'set' data
  newIdRef.set({fake: "data"}); // update the new-id-record using 'set' which works for existing doc

  // Trigger Function should execute and copy 
  // Manual delay so schema trigger function 'onCreate' has time to execute
  await new Promise((r) => setTimeout(r, 2000));

  // 3) Test copy of new '/app/{DocumentId}' against expected object props 
  const newRef = await db.collection('app').doc(newIdRef.id).get();
  const newData = newRef.data();

  const propsExistInAppDoc = obj => {
    return (
      propCheck(obj, 'appInfo', 'appName') && 
      propCheck(obj, 'message', 'error', 'timeout') &&
      propCheck(obj, 'condition', 'messageGlobal') &&
      propCheck(obj, 'spamFilterAkismet', 'key') &&
      propCheck(obj, 'spreadsheet', 'sheetId', 'contactDefault') &&
      propCheck(obj, 'email')
    )
  }

  // Test if newly created doc === global schema doc 
  expect(newData).toStrictEqual(schemaRefData);
  // Test if hardcoded props exist in newly created doc (because what if global 
  // schema doc is empty or has been mutated?) 
  expect(propsExistInAppDoc(newData)).toBe(true);
})


// When Document written to '/TestCollection/{DocumentId}' , trigger function to copy it to '/Copies/{DocumentId}
test("Expect to find a copy in 'Copies' Collection", async () => {
  const testDoc = {
      name: 'Samer',
      age: 21,
      city: 'Riyadh'
  }

  const ref = db.collection('TestCollection').doc()
  await ref.set(testDoc)
  
  const copyId = ref.id

  const copyRef = db.collection('Copies').doc(copyId)

  // DELAY EXECUTION 
  await new Promise((r) => setTimeout(r, 3000))

  const copyDoc = await copyRef.get()
  //console.log("copyDoc", copyDoc);
  //console.log("copyDoc.id", copyDoc.id);
  //console.log("copyDoc.data()", copyDoc.data());
  expect(copyDoc.data()).toStrictEqual(testDoc);
})


/*
const appData = appId => async () => {
  const appRef = await db.collection('app').doc(appId).get();
  const app = appRef.data();
  console.log("app 333333333333333333333333333 ", app);

  return "Hello";

}
*/

/*
// When document written to '/app/{DocumentId}' , trigger function overwrites it
// with copy of '/global/schemaApp' document 
test("Expect new app doc to contain default schemaApp properties", async () => {
//  expect.assertions(true);
  // Create new doc key then 'set' data
  const newKeyRef = db.collection('app').doc();
  console.log("newKeyRef/doc.id $$$$$$$$$$$$$", newKeyRef.id);
  // create the new-key-record using 'set' which works for existing doc
  await newKeyRef.set({});

  await new Promise((r)=>setTimeout(r, 3000))

//  console.log("newKeyRef.id 0000000000000000 ", newKeyRef.id);
  const appRef = await db.collection('app').doc(newKeyRef.id).get();
  const appRef = appData(newKeyRef);
//  console.log("appRef 11111111111111 ", appRef.id);
//  const app = appRef.data();
  console.log("appRef 11111111111111111 ", appRef);

  expect(1).toBe(1);
//  expect(app.condition.messageGlobal).toEqual(true);
});
*/


/*
test("Expect new app doc to contain default schemaApp properties", async () => {

  const appRef = await db.collection('app').doc('AX6VWoRyPlMYegMXRMXj').get();
  console.log("appRef 22222222222222 ", appRef.id);
  const app = appRef.data();
  console.log("app 22222222222222222 ", app);

  expect(1).toBe(1);
});
*/












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

// When Document written to '/TestCollection/{DocumentId}' , trigger function to copy it to '/Copies/{DocumentId}