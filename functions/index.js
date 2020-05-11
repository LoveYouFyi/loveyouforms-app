// FIREBASE FUNCTIONS SDK: to create Cloud Functions and setup triggers ////////
const functions = require('firebase-functions');
// FIREBASE ADMIN SDK: to access the firestore (or firebase) database //////////
const admin = require('firebase-admin');
// DATABASE CREDENTIALS ////////////////////////////////////////////////////////
const serviceAccount = require('./service-account.json'); // download from firebase console
admin.initializeApp({ // initialize firebase admin with credentials
  credential: admin.credential.cert(serviceAccount), // So functions can connect to database
  databaseURL: 'https://loveyou-forms.firebaseio.com' // Needed if using FireBase database (not FireStore)
});
const db = admin.firestore(); // FireStore database reference
// TIMESTAMPS: for adding server-timestamps to database docs ///////////////////
const FieldValue = require('firebase-admin').firestore.FieldValue; // Timestamp here
const timestampSettings = { timestampsInSnapshots: true }; // Define timestamp settings
db.settings(timestampSettings); // Apply timestamp settings to database settingsA
// FUNCTION SUPPORT: for Firestore-to-Sheets function (Google Sheets) //////////
const moment = require('moment-timezone'); // Timestamp formats and timezones
const { google } = require('googleapis');
const sheets = google.sheets('v4'); // Google Sheets
const jwtClient = new google.auth.JWT({ // JWT Authentication (for google sheets)
  email: serviceAccount.client_email, // <--- CREDENTIALS
  key: serviceAccount.private_key, // <--- CREDENTIALS
  scopes: ['https://www.googleapis.com/auth/spreadsheets'] // read and write sheets
});

/*------------------------------------------------------------------------------
  Utility Functions
  For use within cloud functions
------------------------------------------------------------------------------*/

const logErrorInfo = error => ({
  Error: 'Description and source line:',
  description: error,
  break: '**************************************************************',
  Logger: ('Error reported by log enty at:'),
  info: (new Error()),
});

/*------------------------------------------------------------------------------
  Form-Handler HTTP Cloud Function
  Receives data sent by form submission and creates database entry
  Terminate HTTP cloud functions with res.redirect(), res.send(), or res.end()
  https://firebase.google.com/docs/functions/terminate-functions
------------------------------------------------------------------------------*/

exports.formHandler = functions.https.onRequest(async (req, res) => {
  
  let messages;

  try {

    /*--------------------------------------------------------------------------
      Check if Authorized App and if Form submit disabled:
      Stop processing if form submitted by unauthorized app, or submit disabled
    --------------------------------------------------------------------------*/

    const formResults = JSON.parse(req.body); // ajax sent as json-string, so must parse

    const appRef = await db.collection('app').doc(formResults.appKey.value).get();
    const app = appRef.data();

    // App key: if exists continue with global and app condition checks
    if (app) {
      const globalAppRef = await db.collection('global').doc('app').get();
      const globalApp = globalAppRef.data();
      // Messages: use global or app-specific messages
      // global boolean 0/1, if set to 2 bypass global & use app-specific boolean
      if (app.condition.messageGlobal || app.condition.messageGlobal == null) {
        messages = globalApp.message;
      } else {
        messages = app.message;
      }
      // CORS validation: stop cloud function if CORS check does not pass
      // global boolean 0/1, if set to 2 bypass global & use app-specific boolean
      if (!globalApp.condition.corsBypass
          || (globalApp.condition.corsBypass === 2 && !app.condition.corsBypass)
        ) {
        // restrict to url requests that match the app
        res.set('Access-Control-Allow-Origin', app.appInfo.appUrl);
        // end processing if url does not match (req.headers.origin = url)
        if (req.headers.origin !== app.appInfo.appUrl) { 
          console.info(new Error('Origin Url does not match app url.'));
          // no error response sent because submit not from approved app
          return res.end();
        }
      } else {
        // allow * so localhost (or any source) recieves response
        res.set('Access-Control-Allow-Origin', '*');
      }
      // Form Submit Enabled/Disabled: stop cloud function if submitForm disabled
      // global boolean 0/1, if set to 2 bypass global & use app-specific boolean
      if (!globalApp.condition.submitForm
          || (globalApp.condition.submitForm === 2 && !app.condition.submitForm)
        ) {
        console.info(new Error(`Form submit disabled for app "${app.appInfo.appName}"`));
        // return error response because submit is from approved app
        throw (globalApp.message.error.text);
      }
    } else {
      console.info(new Error('App Key does not exist.'));
      // no error response sent because submit not from approved app
      return res.end();
    }


    /*--------------------------------------------------------------------------
      Props/Fields
      Compile database props/fields and form fields as 'props' to be handled as
      object entries; sanitize; add to structured object; submit to database
    --------------------------------------------------------------------------*/

    const appKey = app.id;
    const appInfo = app.appInfo;

    //
    // Form Field Name Defaults: select from db all formFieldName default fields
    // Return Object of docs
    //
    const formFieldNameDefaultsRef = await db.collection('formFieldName').where('default', '==', true).get();
    const formFieldNameDefaults = formFieldNameDefaultsRef.docs.reduce((a, doc) => {
      a[doc.id] = doc.data();
      return a;
    }, {});
    
    //
    // Props All: consolidate available props and fields (order-matters) last-in overwrites previous 
    //
    const propsAll = { appKey, ...formFieldNameDefaults, ...formResults, ...appInfo };

    ////////////////////////////////////////////////////////////////////////////
    // Props Allowed: reduce to allowed props
    //
    // Remove from 'props' any fields not used for database or code actions because:
    // 1) prevents database errors due to querying docs (formFieldName) using 
    //    disallowed values; e.g. if html <input> had name="__anything__"
    //    -->see firebase doc limits: https://firebase.google.com/docs/firestore/quotas#limits
    // 2) only fields used for database or code actions will be included
    //
    // Props Whitelist: compiled from database
    // Database Schema
    //   formFieldName/'all required' --> formFieldNamesRequired
    //   formTemplate/'templateName'/fields --> formTemplateFields
    //   app/'appKey'/appInfo.*props --> appInfo

    //
    // Form Field Names Required: fields required for cloud function to work
    // Return Array of field names
    //
    const formFieldNamesRequiredRef = await db.collection('formFieldName').where('required', '==', true).get();
    const formFieldNamesRequired = formFieldNamesRequiredRef.docs.reduce((a, doc) => {
      a.push(doc.id);
      return a;
    }, []);

    //
    // Form Template Fields:
    // Array of field names for submitForm/*/template.data used by 'trigger email' extension
    //
    const formTemplateRef = await db.collection('formTemplate').doc(propsAll.templateName.value).get();
    const formTemplateFields = formTemplateRef.data().fields;
  
    // Props Whitelist:
    // Array of prop keys allowed for database or code actions (order matters) last-in overwrites previous
    const propsWhitelist = [ ...formFieldNamesRequired, ...formTemplateFields, ...Object.keys(appInfo) ];

    //
    // Props: entries used for database or code actions
    // Return Object
    //
    const propsAllowed = Object.entries(propsAll).reduce((a, [key, value]) => {
      if (propsWhitelist.includes(key)) {
        a[key] = value; 
      } 
      return a;
    }, {});
    //
    // [END] Props Allowed: reduce to allowed props
    ////////////////////////////////////////////////////////////////////////////

   const propsSet = (() => {

      const trim = value => value.toString().trim();

      // compare database fields with form-submitted props and build object
      const parse = propsToParse => Object.entries(propsToParse).reduce((a, [prop, data]) => {
        // appInfo fields do not have a 'value' property
        if (appInfo.hasOwnProperty(prop)) {
          a[prop] = data;
        } else {
          // form fields have 'value' property
          a[prop] = trim(data.value);
        }
        // Form Template Fields: Whitelist check [START]
        if (formTemplateFields.includes(prop) && appInfo.hasOwnProperty(prop)) {
          a.templateData[prop] = data;
        } else if (formTemplateFields.includes(prop)) {
          a.templateData[prop] = trim(data.value);
        }
        // Form Template Fields: Whitelist check [END]
        return a
      }, { templateData: {} });

      return {
        set: props  => {
          return parse(props);
        }
      }
    })();
    //
    // [END] Data Sanitize & Set Props
    ////////////////////////////////////////////////////////////////////////////

    const propsGet = ({ templateData, urlRedirect = false, ...key } = propsSet.set(propsAllowed)) => ({
      data: {
        appKey: key.appKey, 
        createdDateTime: FieldValue.serverTimestamp(), 
        from: key.appFrom, 
        toUids: [ key.appKey ], 
        replyTo: templateData.email,
        template: { 
          name: key.templateName, 
          data: templateData
        }
      },
      urlRedirect: urlRedirect
    });

    // For serverTimestamp to work must first create new doc key then 'set' data
    const newKeyRef = db.collection('submitForm').doc();
    // update the new-key-record using 'set' which works for existing doc
    newKeyRef.set(propsGet().data)


    /*--------------------------------------------------------------------------
      Response to request
    --------------------------------------------------------------------------*/
 
    // return response object (even if empty) so client can finish AJAX success
    return res.status(200).send({
      data: {
        redirect: propsGet().urlRedirect,
        message: messages.success
      }
    });

  } catch(error) {
    
    console.error(logErrorInfo(error));

    return res.status(500).send({
      error: {
        message: messages.error
      }
    });

  } // end catch

});

/*------------------------------------------------------------------------------
  Firestore-to-Sheets Trigger Cloud Function
  Listens for new 'submitForm' collection docs and adds data to google sheets.
  If required, creates new sheet(tab) and row header.
------------------------------------------------------------------------------*/

exports.firestoreToSheets = functions.firestore.document('submitForm/{formId}')
  .onCreate(async (snapshot, context) => {

  try {

    /*--------------------------------------------------------------------------
      Prepare row data values and sheet header
    --------------------------------------------------------------------------*/

    // Form Submission: values from Snapshot.data()
    const { appKey, createdDateTime, template: { data: { ...templateData }, 
      name: templateName  } } = snapshot.data();

    // App Doc
    const appRef = await db.collection('app').doc(appKey).get();
    const app = appRef.data();
 
    // Template: two sort-ordered arrays of strings
    // headerRowSheet array is sorted according to desired sheets visual
    // templateData array is sorted to match the order of headerRowSheet
    const formTemplateRef = await db.collection('formTemplate').doc(templateName).get();
    const formTemplate = formTemplateRef.data();

    // Header fields for sheet requires nested array of strings [ [ 'Date', 'Time', etc ] ]
    const headerRowSheet = [( formTemplate.headerRowSheet )]; 

    ////////////////////////////////////////////////////////////////////////////
    // Row Data: Sort & Merge
    //
    // Strings to 'prop: value' objects so data to be merged has uniform format
    // timezone 'tz' string defined by momentjs.com/timezone:
    // https://github.com/moment/moment-timezone/blob/develop/data/packed/latest.json
    const dateTime = createdDateTime.toDate(); // toDate() is firebase method
    const createdDate = moment(dateTime).tz(app.appInfo.appTimeZone).format('L');
    const createdTime = moment(dateTime).tz(app.appInfo.appTimeZone).format('h:mm A z');
    // Reduce array formTemplate.templateData, this returns an object that 
    // is sort-ordered to match database headerRowSheet fields of array.
    const templateDataSorted = formTemplate.fields.reduce((a, fieldName) => {
      templateData[fieldName] ? a[fieldName] = templateData[fieldName] : a[fieldName] = "";
      return a
    }, {});
    // Merge objects in sort-order and return only values
    // Data-row for sheet requires nested array of strings [ [ 'John Smith', etc ] ]
    const sheetDataRow = [(
      Object.values({ 
        createdDate,
        createdTime, 
        ...templateDataSorted 
      })
    )];
    //
    // [END] Row Data: Sort & Merge
    ////////////////////////////////////////////////////////////////////////////


    /*--------------------------------------------------------------------------
      Prepare to insert data-row into app spreadsheet
    --------------------------------------------------------------------------*/

    // Get app spreadsheetId and sheetId (one spreadsheet with multiple sheets possible)
    const spreadsheetId = app.spreadsheet.id; // one spreadsheet per app
    const sheetId = app.spreadsheet.sheetId[templateName]; // multiple possible sheets

    // Authorize with google sheets
    await jwtClient.authorize();

    // Row: Add to sheet (header or data)
    const rangeHeader =  `${templateName}!A1`; // e.g. "contactDefault!A1"
    const rangeData =  `${templateName}!A2`; // e.g. "contactDefault!A2"

    const addRow = range => values => ({
      auth: jwtClient,
      spreadsheetId: spreadsheetId,
      ...range && { range }, // e.g. "contactDefault!A2"
      valueInputOption: "RAW",
      requestBody: {
        ...values && { values }
      }
    });
    
    // Row: Blank insert (sheetId argument: existing vs new sheet)
    const blankRowInsertAfterHeader = sheetId => ({
      auth: jwtClient,
      spreadsheetId: spreadsheetId,
      resource: {
        requests: [
          {
            "insertDimension": {
              "range": {
                "sheetId": sheetId,
                "dimension": "ROWS",
                "startIndex": 1,
                "endIndex": 2
              },
              "inheritFromBefore": false
            }
          }
        ]
      }
    });


    /*--------------------------------------------------------------------------
      Insert row data into sheet that matches template name
    --------------------------------------------------------------------------*/

    // Check if sheet name exists for data insert
    const sheetObjectRequest = () => ({
      auth: jwtClient,
      spreadsheetId: spreadsheetId,
      includeGridData: false
    });
    const sheetDetails = await sheets.spreadsheets.get(sheetObjectRequest());
    const sheetNameExists = sheetDetails.data.sheets.find(sheet => {
      // if sheet name exists returns sheet 'properties' object, else is undefined
      return sheet.properties.title === templateName;
    });

    // If sheet name exists, insert data
    // Else, create new sheet + insert header + insert data
    if (sheetNameExists) {
      // Insert into spreadsheet a blank row and the new data row
      await sheets.spreadsheets.batchUpdate(blankRowInsertAfterHeader(sheetId));
      await sheets.spreadsheets.values.update(addRow(rangeData)(sheetDataRow));

    } else {
      // Create new sheet, insert heder and new row data
      
      // Request object for adding sheet to existing spreadsheet
      const addSheet = () => ({
        auth: jwtClient,
        spreadsheetId: spreadsheetId,
        resource: {
          requests: [
            {
              "addSheet": {
                "properties": {
                  "title": templateName,
                  "index": 0,
                  "gridProperties": {
                    "rowCount": 1000,
                    "columnCount": 26
                  },
                }
              } 
            }
          ]
        }
      });

      // Add new sheet:
      // 'addSheet' request object returns new sheet properties
      // Get new sheetId and add to app spreadsheet info
      // newSheet returns 'data' object with properties:
      //   prop: spreadsheetId
      //   prop: replies[0].addSheet.properties (sheetId, title, index, sheetType, gridProperties { rowCount, columnCount }
      const newSheet = await sheets.spreadsheets.batchUpdate(addSheet());
      // Map 'replies' array to get sheetId
      const newSheetId = sheet => {
        const newSheet = {};
        sheet.data.replies.map(reply => newSheet.addSheet = reply.addSheet);
        return newSheet.addSheet.properties.sheetId;
      };

      // Add new sheetId to app spreadsheet info
      db.collection('app').doc(appKey).update({
        ['spreadsheet.sheetId.' + templateName]: newSheetId(newSheet)
      });

      // New Sheet Actions: add row header then row data
      await sheets.spreadsheets.values.update(addRow(rangeHeader)(headerRowSheet));
      await sheets.spreadsheets.values.update(addRow(rangeData)(sheetDataRow));

    } // end 'else' add new sheet

  } catch(error) {
    
    console.error(logErrorInfo(error));

  } // end catch

});

/*------------------------------------------------------------------------------
  Doc-Schema Trigger Cloud Functions
  When a new 'doc' is created this adds default fields/schema to it
------------------------------------------------------------------------------*/

// New 'app' Collection Trigger Cloud Function: Add default schema
exports.schemaApp = functions.firestore.document('app/{appId}')
  .onCreate(async (snapshot, context) => {

  try {

    // Schema Default for App
    const schemaAppRef = await db.collection('global').doc('schemaApp').get();
    const schemaApp = schemaAppRef.data();

    // Update new app doc with default schema
    const appRef = db.collection('app').doc(context.params.appId);
    appRef.set(schemaApp); // update record with 'set' which is for existing doc

  } catch(error) {
    
    console.error(logErrorInfo(error));

  } // end catch

});

// New 'formTemplate' Collection Trigger Cloud Function: Add default schema
exports.schemaFormTemplate = functions.firestore.document('formTemplate/{formTemplateId}')
  .onCreate(async (snapshot, context) => {

  try {

    // Schema Default for App
    const schemaFormTemplateRef = await db.collection('global').doc('schemaFormTemplate').get();
    const schemaFormTemplate = schemaFormTemplateRef.data();

    // Update new app doc with default schema
    const formTemplateRef = db.collection('formTemplate').doc(context.params.formTemplateId);
    formTemplateRef.set(schemaFormTemplate); // update record with 'set' which is for existing doc

  } catch(error) {
    
    console.error(logErrorInfo(error));

  } // end catch

});


/*------------------------------------------------------------------------------
  Firebase-to-Sheets Trigger Cloud Function
  Basic two column list
------------------------------------------------------------------------------*/

exports.firebaseToSheets = functions.database.ref('/Form')
  .onUpdate(async change => {

  let data = change.after.val();
  console.log("data ################ ", data);
  // Convert JSON to Array following structure below
  //
  //[
  //  ['COL-A', 'COL-B'],
  //  ['COL-A', 'COL-B']
  //]
  //
  let itemArray = [];
  let valueArray = [];
  Object.keys(data).forEach((key, index) => {
    itemArray.push(key);
    itemArray.push(data[key]);
    console.log("itemArray ############################# ", itemArray);
    valueArray[index] = itemArray;
    itemArray = [];
  });

  let maxRange = valueArray.length + 1;

  // Do authorization
  await jwtClient.authorize();
  console.log("valueArray ############################# ", valueArray) 

  // Create Google Sheets request
  let request = {
    auth: jwtClient,
    spreadsheetId: "1nOzYKj0Gr1zJPsZv-GhF00hUAJ2sTsCosMk4edJJ9nU",
    range: "Firebase!A2:B" + maxRange,
    valueInputOption: "RAW",
    requestBody: {
      values: valueArray
    }
  };
  
  // Update data to Google Sheets
  await sheets.spreadsheets.values.update(request, {});
});

