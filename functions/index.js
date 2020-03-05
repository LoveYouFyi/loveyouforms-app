// SECTION Requirements

// Cloud Functions for Firebase SDK to create Cloud Functions and setup triggers.
const functions = require('firebase-functions');
// Firebase Admin SDK to access the Firebase/Firestore Realtime Database.
const admin = require('firebase-admin');
// [**** CREDENTIALS START ****]
const serviceAccount = require('./service-account.json'); // download from firebase console
admin.initializeApp({ // initialize firebase admin with credentials
  credential: admin.credential.cert(serviceAccount), // So functions can connect to database
  databaseURL: 'https://loveyou-forms.firebaseio.com' // Needed if using FireBase database (not FireStore)
});
// [**** CREDENTIALS STOP ****]
const db = admin.firestore(); // FireStore database reference
// Timestamps: required for adding server-timestamps to any database docs
const FieldValue = require('firebase-admin').firestore.FieldValue; // Timestamp here
const timestampSettings = { timestampsInSnapshots: true}; // Define timestamp settings
db.settings(timestampSettings); // Apply timestamp settings to database settings
const moment = require('moment-timezone'); // Timestamp formats and timezones
// Google APIs
const { google } = require('googleapis');
const sheets = google.sheets('v4'); // Google Sheets
const jwtClient = new google.auth.JWT({ // JWT Authentication (for google sheets)
  email: serviceAccount.client_email, // [**** CREDENTIALS ****]
  key: serviceAccount.private_key, // [**** CREDENTIALS ****]
  scopes: ['https://www.googleapis.com/auth/spreadsheets'] // read and write sheets
});

// !SECTION

// SECTION Logging and Errors

const logErrorInfo = error => ({
  Error: 'Description and source line:',
  description: error,
  break: '**************************************************************',
  Logger: ('Error reported by log enty at:'),
  info: (new Error()),
});

const responseErrorBasic = string => ({
  message: {
    error: string
  }
});

// !SECTION

// Terminate HTTP functions with res.redirect(), res.send(), or res.end().
// Terminate a synchronous function with a return; statement.
// https://firebase.google.com/docs/functions/terminate-functions

// ANCHOR Form Handler
exports.formHandler = functions.https.onRequest(async (req, res) => {

  try {

    const fields = (() => {
      const type = {
        info: {},
        template: {}
      };
      const allowType = ['info', 'template'];
      const formField = [ 'email', 'message', 'name', 'phone', 
            'radioTimeframe', 'selectService', 'templateName', 'urlRedirect', 
            'webformId' ];
      const ignoreSanitize = [ 'appInfoFrom', 'appInfoName', 'appInfoTimeZone', 'appInfoUrl' ];
      const allowProps = formField.concat(ignoreSanitize);
      let sanitizeValue = (value, maxLength) => 
        value.toString().trim().substr(0, maxLength);
    
      let addProp = (typeName, propName, value) => {
        Object.assign(type[typeName], { [propName]: value });
      }
      return {
        add: (typeName, propName, value, maxLength) => {
          if (!allowType.includes(typeName)) { 
            console.error(`Error: 'Type Name' you entered '${typeName}', must be one of: ${allowType}`); 
          } else if (!allowProps.includes(propName)) {
            console.error(`Error: 'Prop Name' you entered '${propName}' must be one of: ${allowProps}`); 
          } else if (ignoreSanitize.includes(propName)) {
            addProp(typeName, propName, value);
          } else {
            let valueSanitized = sanitizeValue(value, maxLength);
            addProp(typeName, propName, valueSanitized);
          }
        },
        type: () => {
          return type;
        },
      }
    })();
   
    let iFields = fields.type().info;    
    let tFields = fields.type().template;

    ////////////////////////////////////////////////////////////////////////////

    const sanitizedHelperFields = {};
    const sanitizedTemplateDataFields = {};

    /**
     * Global config
     */
    const globals = await db.collection('global').get();
    const globalConfig = globals.docs.reduce((object, doc) => { 
      object[doc.id] = doc.data();
      return object;
    }, {});


    /**
     *  Check if form submitted by authorized app or stop processing cloud function
     */
   
    // App key validation: if does not exist stop processing otherwise get app info
    const app = await db.collection('app').doc(req.body.appKey).get();
    if (app) {
      let { from, name, url, timeZone } = app.data().appInfo;
      fields.add('info', 'appInfoFrom', from);
      fields.add('info', 'appInfoName', name);
      fields.add('info', 'appInfoUrl', url);
      fields.add('template', 'appInfoTimeZone', timeZone);
    } else {
      console.info(new Error('App Key does not exist.'));
      res.end();
    }


    // CORS validation: stop cloud function if CORS check does not pass
    if (globalConfig.cors.bypass) {
      // allow * so localhost (or any source) recieves response
      res.set('Access-Control-Allow-Origin', '*');
    } else {
      // restrict to url requests that match the app
      res.set('Access-Control-Allow-Origin', iFields.appInfoUrl);
      // end processing if url does not match (req.headers.origin = url)
      if (req.headers.origin !== iFields.appInfoUrl) { 
        console.info(new Error('Origin Url does not match app url.'));
        return res.end();
      } 
    }

    // Url redirect: global redirect unless overridden by form field (below)
//    sanitizedHelperFields.urlRedirect = globalConfig.urlRedirect.default;
    fields.add('info', 'urlRedirect', globalConfig.urlRedirect.default);

    console.log("Log 7 ", fields.type());

    /**
     * Form submission handle fields
     */

    let { 
      // destructure fields that should not be included with template fields
      templateName = 'contactDefault', webformId, urlRedirect, appKey,
      // collect template fields 
      ...templateData 
    } = req.body; // Form submission

    // Sanitize 
    const formFields = await db.collection('formField').get();

    for (const doc of formFields.docs) {
      let maxLength = doc.data().maxLength;
      if (templateData[doc.id]) {
//        sanitizedTemplateDataFields[doc.id] = sanitizeString(templateData[doc.id], maxLength);
        fields.add("template", doc.id, templateData[doc.id], maxLength );
      } else if (req.body[doc.id]) {
//        sanitizedHelperFields[doc.id] = sanitizeString(req.body[doc.id], maxLength);
        fields.add("info", doc.id, req.body[doc.id], maxLength );
      }
    }
    console.log("Log 8 ", fields.type());
    console.log("Here $$$$$$$$$$$$$$$$$$$$ ", iFields.templateName);
    console.log("Here $$$$$$$$$$$$$$$$$$$$ ", iFields.templateName);
    console.log("tFields $$$$$$$$$$$$$$$$$$$$ ", tFields);
    console.log("fields.type().template $$$$$$$$$$$$$$$$$$$$ ", fields.type().template);

    // Build object to be saved to db
    const data = {
      // spread operator conditionally adds, otherwise function errors if not exist
      // 'from' email if not assigned comes from firebase extension field: DEFAULT_FROM
      appKey,
      createdDateTime: FieldValue.serverTimestamp(),
      ...iFields.appInfoFrom && { from: iFields.appInfoFrom },
      toUids: [ appKey ], // toUids = to email: format required by cloud extension 'trigger email'
      ...tFields.email && {replyTo: tFields.email},
      ...iFields.webformId && { webformId: iFields.webformId },
      template: {
        name: iFields.templateName,
        data: tFields
      }
    };

    // For serverTimestamp to work must first create new doc key then 'set' data
    const newKey = db.collection("formSubmission").doc();
    // update the new-key-record using 'set' which works for existing doc
    newKey.set(data);

    /**
     * Response
     */
    let responseBody = { 
      data: {
        redirect: iFields.urlRedirect
      }
    }
    
    return res.status(200).send(
      // return response (even if empty) so client can finish AJAX success
      responseBody
    );

  } catch(error) {

    console.error(logErrorInfo(error));

    return res.status(500).send(responseErrorBasic('Error: Application error.'));

  } // end catch

});


// ANCHOR - Firestore To Sheets [Nested email template data]
exports.firestoreToSheets = functions.firestore.document('formSubmission/{formId}')
  .onCreate(async (snapshot, context) => {
  
  let dataRow = {}; // sorted data to be converted to array for submit to sheet
  let dataRowForSheet; // data row as array to submit to sheet
  let emailTemplateName;
  let emailTemplateData;
  let appKeySubmitted; // use in submit data
  let spreadsheetId;
  let sheetId;
  let sheetHeader;

  try {
    /**
    * Prepare Data Row 
    */

    // Destructure Snapshot.data() which contains this form submission data
    let { appKey, createdDateTime, template: { data: { ...rest }, 
      name: templateName  }, webformId } = snapshot.data(); 
    // For building sort-ordered object that is turned into sheet data-row
    emailTemplateName = templateName;
    emailTemplateData = rest;
    // appkey to query 'spreadsheet' object info
    appKeySubmitted = appKey;
    // date/time: timezone string defined by momentjs.com/timezone: https://github.com/moment/moment-timezone/blob/develop/data/packed/latest.json
    const dateTime = createdDateTime.toDate(); // toDate() is firebase method
    // Add date-time to start of data object, format date with moment.js
    dataRow.createdDate = moment(dateTime).tz(rest.appInfoTimeZone).format('L');
    dataRow.createdTime = moment(dateTime).tz(rest.appInfoTimeZone).format('h:mm A z');
    // Add webformId to data object
    dataRow.webformId = webformId;

    // Template arrays for sort-ordered data-row and header fields
    let emailTemplateDoc = await db.collection('emailTemplate').doc(emailTemplateName).get();
    // data-row fields: sort ordered with empty string values
    emailTemplateDoc.data().templateData.map(field => dataRow[field] = ""); // add prop name + empty string value
    // header fields for sheet
    sheetHeader = [( emailTemplateDoc.data().sheetHeader )]; // sheets requires array within an array

    // Update sort-ordered props with data values
    Object.assign(dataRow, emailTemplateData);
    // Object to array because sheets data must be as array
    dataRow = Object.values(dataRow);
    // Sheets Row Data to add as array nested in array: [[ date, time, ... ]]
    dataRowForSheet = [( dataRow )];

    /**
    * Prepare to insert data-row in app-specific spreadsheet
    */

    // Get app spreadsheetId and sheetId based on formSubmission emailTemplate
    let appDoc = await db.collection('app').doc(appKeySubmitted).get();
    spreadsheetId = appDoc.data().spreadsheet.id;
    sheetId = appDoc.data().spreadsheet.sheetId[emailTemplateName];

    // Authorize with google sheets
    await jwtClient.authorize();

    // Row: Add to sheet (header or data)
    const rangeHeader =  `${emailTemplateName}!A1`; // e.g. "contactDefault!A2"
    const rangeData =  `${emailTemplateName}!A2`; // e.g. "contactDefault!A2"

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

    /**
    * Insert row data into sheet that matches template name
    */

    // Check if sheet name exists for data insert
    const sheetObjectRequest = {
      auth: jwtClient,
      spreadsheetId: spreadsheetId,
      includeGridData: false
    };
    let sheetDetails = await sheets.spreadsheets.get(sheetObjectRequest);
    let sheetNameExists = sheetDetails.data.sheets.find(sheet => {
      // if sheet name exists returns sheet 'properties' object, else is undefined
      return sheet.properties.title === emailTemplateName;
    });

    // If sheet name exists, insert data
    // Else, create new sheet + insert header + insert data
    if (sheetNameExists) {
      // Update Google Sheets Data
      await sheets.spreadsheets.batchUpdate(blankRowInsertAfterHeader(sheetId));
      await sheets.spreadsheets.values.update(addRow(rangeData)(dataRowForSheet));

    } else {

      // Add sheet
      const addSheet = {
        auth: jwtClient,
        spreadsheetId: spreadsheetId,
        resource: {
          requests: [
            {
              "addSheet": {
                "properties": {
                  "title": emailTemplateName,
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
      };

      // Add sheet and return new sheet properties
      let newSheet = await sheets.spreadsheets.batchUpdate(addSheet);

      // Get new sheetId and add to app spreadsheet info
      // newSheet returns 'data' object with properties:
      // prop: spreadsheetId
      // prop: replies[0].addSheet.properties (sheetId, title, index, sheetType, gridProperties { rowCount, columnCount }
      // Map replies array array to get sheetId
      let newSheetProps = {};
      newSheet.data.replies.map(reply => newSheetProps.addSheet = reply.addSheet); 
      let newSheetId = newSheetProps.addSheet.properties.sheetId;

      // Add new sheetId to app spreadsheet info
      db.collection('app').doc(appKeySubmitted).update({
          ['spreadsheet.sheetId.' + emailTemplateName]: newSheetId
      });

      // New Sheet Actions: add rows for header, then data
      await sheets.spreadsheets.values.update(addRow(rangeHeader)(sheetHeader));
      return sheets.spreadsheets.values.update(addRow(rangeData)(dataRowForSheet));

    } // end 'else' add new sheet

  } catch(error) {
    
    console.error(logErrorInfo(error));

    // 'res' is not defined, so cannot use it

  } // end catch

});


// ANCHOR Firebase to Sheets [Basic 2 Column List]
exports.firebaseToSheets = functions.database.ref("/Form")
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

