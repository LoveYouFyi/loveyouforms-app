// Test with Jest
const firebase = require('@firebase/testing') //<--- You want this to be the top guy!!!
const admin = require('firebase-admin')

const projectId = "loveyou-forms";
process.env.GCLOUD_PROJECT = projectId;
process.env.FIRESTORE_EMULATOR_HOST = "localhost:8000";
let app = admin.initializeApp({projectId})
let db = firebase.firestore(app)

/*------------------------------------------------------------------------------
  Utility Functions 
------------------------------------------------------------------------------*/

// Prop Check: checks if prop exists with nesting up to three levels 
const propCheck = (obj, l1, l2, l3) => {
  return (
    l3 ? obj[l1][l2].hasOwnProperty(l3) ? true : false :
    l2 ? obj[l1].hasOwnProperty(l2) ? true : false :
    obj.hasOwnProperty(l1) ? true : false
  )
}

/*------------------------------------------------------------------------------
  Test Schema Triggers 
  When Document written to '/app/{DocumentId}', a trigger function overwrites
  it with the document copied from '/global/schemaApp'
------------------------------------------------------------------------------*/
test("Expect new '/app/{DocumentId}' === '/global/schemaApp' doc", async () => {
  jest.setTimeout(15000); // increase jest default async timeout to time-delays have enough time 

  // 1) Get copy of /global/schema* doc data 
  const schemaData = async (col, doc) => {
    const schemaRef = await db.collection(col).doc(doc).get();
    return schemaRef.data();
  }

  // 2) Create new doc -> allow schema trigger time to run -> return new doc data 
  const newDoc = async (col) => {
    // Create new doc with single-level prop by hardcoding the object since 
    // that's how someone would add a new app to the database 
    const newIdRef = db.collection(col).doc(); // First create new doc id (so we know the id) then 'set' data
    newIdRef.set({fake: "data"}); // update the new-id-record using 'set' which works for existing doc

    // Trigger Function should execute and copy /global/schema* doc to new doc 
    // Manual delay so schema trigger function 'onCreate' has time to execute
    await new Promise((r) => setTimeout(r, 1500));

    // Doc Data should contain data copied from /global/schema* doc 
    const newRef = await db.collection(col).doc(newIdRef.id).get();
    return newRef.data();
  }

  ////
  // Expect Set #1
  // Test if collection newly created doc === global schema doc 
  ////
  expect(await newDoc('app'))
    .toStrictEqual(await schemaData('global', 'schemaApp'));

  expect(await newDoc('formTemplate'))
    .toStrictEqual(await schemaData('global', 'schemaFormTemplate'));

  //////////////////////////////////////////////////////////////////////////////
  // Test if hardcoded props exist in newly created schema doc (because what if 
  // global schema doc is empty or has been mutated?) 

  const appCollectionPropsCheck = obj => {
    return (
      propCheck(obj, 'appInfo', 'appName') && 
      propCheck(obj, 'message', 'error', 'timeout') &&
      propCheck(obj, 'condition', 'messageGlobal') &&
      propCheck(obj, 'spamFilterAkismet', 'key') &&
      propCheck(obj, 'spreadsheet', 'sheetId', 'contactDefault') &&
      propCheck(obj, 'email')
    )
  }
  const formTemplateCollectionPropsCheck = obj => {
    return (
      propCheck(obj, 'fields', 0) &&
      propCheck(obj, 'fieldsAkismet', 'other') && 
      propCheck(obj, 'html') &&
      propCheck(obj, 'subject') 
    )
  }

  ////
  // Expect Set #2
  // Check 'app' and 'formTemplate' collections for these hard-coded props 
  ////
  
  expect(appCollectionPropsCheck(await newDoc('app')))
    .toBe(true);

  expect(formTemplateCollectionPropsCheck(await newDoc('formTemplate')))
    .toBe(true);

}) // Test End 
