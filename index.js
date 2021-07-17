/*------------------------------------------------------------------------------
  Cloud Functions
------------------------------------------------------------------------------*/

/*-- Dependencies ------------------------------------------------------------*/
// Firebase Functions SDK: to create Cloud Functions and setup triggers
const functions = require('firebase-functions');
// Environment Keys: to set variables based on environments dev vs prod
const env = require('../../config/public.js');


/*-- Form-Handler HTTP Cloud Function ----------------------------------------*/
const formHandler = require('./src/form-handler');
module.exports.formHandler = functions.https
  .onRequest(formHandler(env));


/*-- Firestore-to-Sheets Trigger Cloud Function ------------------------------*/
const firestoreToSheets = require('./src/firestore-to-sheets');
module.exports.firestoreToSheets = functions.firestore
  .document('submitForm/{formId}')
  .onCreate(firestoreToSheets(env));


/*-- Schema-Default Trigger Cloud Functions ----------------------------------*/
const schemaDefault = require('./src/schema-default');

// 'app' collection default schema function
module.exports.schemaApp = functions.firestore
  .document('app/{id}')
  .onCreate(schemaDefault('app', 'schemaApp', env));

// 'formTemplate' collection default schema function
module.exports.schemaFormTemplate = functions.firestore
  .document('formTemplate/{id}')
  .onCreate(schemaDefault('formTemplate', 'schemaFormTemplate', env));
