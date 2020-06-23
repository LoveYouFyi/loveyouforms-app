
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
const schemaDefault = require('./src/schema-default');


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

module.exports.schemaApp = functions.firestore.document('app/{id}')
  .onCreate(schemaDefault('app', 'schemaApp', context));

// Default schema functions for 'app' and 'formTemplate' collections
//module.exports.schemaApp = schemaDefault('app', 'schemaApp'),
//module.exports.schemaFormTemplate = schemaDefault('formTemplate', 'schemaFormTemplate')

module.exports.schemaFormTemplate = functions.firestore.document('formTemplate/{id}')
  .onCreate(schemaDefault('formTemplate', 'schemaFormTemplate', context));
