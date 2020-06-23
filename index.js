
/*-- Dependencies all cloud functions ----------------------------------------*/

// Firebase Functions SDK: to create Cloud Functions and setup triggers
const functions = require('firebase-functions');
// Firebase Admin SDK: to interact with the Firestore database
const admin = require('firebase-admin');
admin.initializeApp(); // initialize firebase admin SDK
admin.firestore().settings({ timestampsInSnapshots: true }); // to write server-timestamps to database docs
const db = admin.firestore(); // FireStore database reference
const context = { admin };
// Cloud Functions
const formHandler = require('./src/form-handler');
const firestoreToSheets = require('./src/firestore-to-sheets');


/*------------------------------------------------------------------------------
  Form-Handler HTTP Cloud Function
  Receives data sent by form submission and creates database entry
  Terminate HTTP cloud functions with res.redirect(), res.send(), or res.end()
------------------------------------------------------------------------------*/
module.exports.formHandler = functions.https.onRequest(formHandler(context));


/*------------------------------------------------------------------------------
  Firestore-to-Sheets Trigger Cloud Function
  Listens for new 'submitForm' collection docs and adds data to google sheets.
  If required, creates new sheet(tab) and row header.
------------------------------------------------------------------------------*/
module.exports.firestoreToSheets = functions.firestore.document('submitForm/{formId}')
  .onCreate(firestoreToSheets(context));


/*------------------------------------------------------------------------------
  Doc-Schema Trigger Cloud Functions
  When a new 'doc' is created this adds default fields/schema to it
  Parameters: 'col' is collection type and 'schema' is from 'global' collection
------------------------------------------------------------------------------*/

const schemaDefault = (col, schema) => functions.firestore.document(`${col}/{id}`)
  .onCreate(async (snapshot, context) => {

  try {

    // Get Default Schema
    const schemaRef = await db.collection('global').doc(schema).get();
    const schemaData = schemaRef.data();

    // Update new doc with default schema
    const appRef = db.collection(col).doc(context.params.id);
    appRef.set(schemaData); // update record with 'set' which is for existing doc

    return schemaData;

  } catch(error) {

    console.error(logErrorInfo(error));

  }

});

// Default schema functions for 'app' and 'formTemplate' collections
module.exports.schemaApp = schemaDefault('app', 'schemaApp'),
module.exports.schemaFormTemplate = schemaDefault('formTemplate', 'schemaFormTemplate')
