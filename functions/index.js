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

// SECTION Helper Functions

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
// https://firebase.google.com/docs/functions/terminate-functions

// ANCHOR Form Handler
exports.formHandler = functions.https.onRequest(async (req, res) => {

  try {
    
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

    const app = await db.collection('app').doc(req.body.appKey).get();

    // App key validation: if exists continue with cors validation
    if (app) {
      // CORS validation: stop cloud function if CORS check does not pass
      if (globalConfig.cors.bypass) {
        // allow * so localhost (or any source) recieves response
        res.set('Access-Control-Allow-Origin', '*');
      } else {
        // restrict to url requests that match the app
        res.set('Access-Control-Allow-Origin', app.data().appInfo.appUrl);
        // end processing if url does not match (req.headers.origin = url)
        if (req.headers.origin !== app.data().appInfo.appUrl) { 
          console.info(new Error('Origin Url does not match app url.'));
          return res.end();
        } 
      }
    } else {
      console.info(new Error('App Key does not exist.'));
      res.end();
    }


    /**
     *  Continue with form processing since passed valid app checks
     */

    let appKey = app.id;
    let appInfoObject = app.data().appInfo;

    let { ...formElements } = req.body; 

    let templateName = formElements.templateName 
      ? formElements.templateName
      : globalConfig.defaultTemplate.name;

    let urlRedirect = formElements.urlRedirect
      ? formElements.urlRedirect
      : globalConfig.urlRedirect.default;

    // formElements last to allow override of global props
    let props = { appKey, ...appInfoObject, templateName, urlRedirect, ...formElements }

    // formField contains maxLength values for data sanitize
    let formFields = await db.collection('formField').get();
    // Whitelist template data contains props allowed to be added to email template
    let whitelistTemplateData = await db.collection('emailTemplate').doc(templateName).get();

    let sanitize = (value, maxLength) => 
      value.toString().trim().substr(0, maxLength);

    let propsPrimed = formFields.docs.reduce((a, doc) => {
      let maxLength = doc.data().maxLength;
      if (props[doc.id]) {
        let sanitized = sanitize(props[doc.id], maxLength);
        a[doc.id] = sanitized;
        if (whitelistTemplateData.data().templateData.includes(doc.id)) {
          a.templateData[doc.id] = sanitized; 
        } 
      } 
      return a
    }, { templateData: {} });

    console.log("gotVals $$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$ ", propsPrimed);
    console.log("gotVals.templateData $$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$ ", propsPrimed.templateData);
    
    /**************************************************************************/

    let sanitizeMe = (value, maxLength) => 
      value.toString().trim().substr(0, maxLength);

    let propsPrime = (() => { 
      
      let getProps = formFields.docs.reduce((a, doc) => {
        let maxLength = doc.data().maxLength;
        if (props[doc.id]) {
          let sanitized = sanitizeMe(props[doc.id], maxLength);
          a[doc.id] = sanitized;
          if (whitelistTemplateData.data().templateData.includes(doc.id)) {
            a.templateData[doc.id] = sanitized; 
          } 
        } 
        return a
      }, { templateData: {} });

      return {
        get: () => {
          console.log("getProps $$$$$$$$$$$$$$$$$$$$$$$$$$$$$ ", getProps);
          console.log("formFields.docs $$$$$$$$$$$$$$$$$ ", formFields.docs);
          console.log("props $$$$$$$$$$$$$$$$$ ", props);
          console.log("sanitizeMe $$$$$$$$$$$$$$$$$$$$$$$$$$ ", sanitizeMe);
          console.log("whitelistTemplateData $$$$$$$$$$$$$$$$$ ", whitelistTemplateData);
          return getProps;
        }
      }
    })();

    console.log("propsPrime() $$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$ ", propsPrime.get());
//    console.log("propsPrime().templateData $$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$ ", propsPrime.get().templateData);

    /**************************************************************************/

    let propsGet = ({ templateData, urlRedirect, ...key } = propsPrimed) => ({
      data: {
        appKey: key.appKey, 
        createdDateTime: FieldValue.serverTimestamp(), 
        from: key.appFrom, 
        toUids: [ key.appKey ], 
        replyTo: templateData.email,
        webformId: key.webformId, 
        template: { 
          name: key.templateName, 
          data: templateData
        }
      },
      urlRedirect: urlRedirect
    });
    console.log("getGot().data $$$$$$$$$$$$$$$$$$$$$$$$$$$$$ ", propsGet().data);
    console.log("getGot().urlRedirect $$$$$$$$$$$$$$$$$$$$$$$$$$$$$ ", propsGet().urlRedirect);
    

    // For serverTimestamp to work must first create new doc key then 'set' data
    const newKey = db.collection("formSubmission").doc();
    // update the new-key-record using 'set' which works for existing doc
    newKey.set(propsGet().data)

    /**
     * Response
     */

    return res.status(200).send({
      // return response (even if empty) so client can finish AJAX success
      data: {
        // FIXME GET: urlRedirect
        redirect: propsGet().urlRedirect
      }
    });

  } catch(error) {

    console.error(logErrorInfo(error));

    return res.status(500).send(responseErrorBasic('Error: Application error.'));

  } // end catch

});


// ANCHOR - Firestore To Sheets [New sheet, header, and data row]
exports.firestoreToSheets = functions.firestore.document('formSubmission/{formId}')
  .onCreate(async (snapshot, context) => {

  try {

    /**
    * Prepare row data values and sheet header
    */

    // Form Submission: values from Snapshot.data()
    let { appKey, createdDateTime, template: { data: { ...templateData }, 
      name: templateName  }, webformId } = snapshot.data();

    // Template: two sort-ordered arrays of strings
    // sheetHeader array is sorted according to desired sheets visual
    // templateData array is sorted to match the order of sheetHeader
    let emailTemplate = await db.collection('emailTemplate').doc(templateName).get();

    // Header fields for sheet requires nested array of strings [ [ 'Date', 'Time', etc ] ]
    let sheetHeader = [( emailTemplate.data().sheetHeader )]; 

    /** [Start] Row Data: Sort & Merge ****************************************/
    // Strings to 'prop: value' objects so data to be merged has uniform format
    // timezone 'tz' string defined by momentjs.com/timezone: https://github.com/moment/moment-timezone/blob/develop/data/packed/latest.json
    const dateTime = createdDateTime.toDate(); // toDate() is firebase method
    let createdDate = moment(dateTime).tz(templateData.appTimeZone).format('L');
    let createdTime = moment(dateTime).tz(templateData.appTimeZone).format('h:mm A z');
    // Reduce array emailTemplate.templateData, this returns an object that 
    // is sort-ordered to matach the sheetHeader fields.
    let templateDataSorted = emailTemplate.data().templateData.reduce((a, c) => {
      templateData[c] ? a[c] = templateData[c] : a[c] = "";
      return a
    }, {});
    // Merge objects in sort-order and return only values
    // Data-row for sheet requires nested array of strings [ [ 'John Smith', etc ] ]
    let sheetDataRow = [( Object.values({ createdDate, createdTime, 
      webformId, ...templateDataSorted }) )];
    /** [End] Row Data: Sort & Merge ******************************************/


    /**
    * Prepare to insert data-row into app spreadsheet
    */

    // Get app spreadsheetId and sheetId (one spreadsheet with multiple sheets possible)
    let app = await db.collection('app').doc(appKey).get();
    let spreadsheetId = app.data().spreadsheet.id; // one spreadsheet per app
    let sheetId = app.data().spreadsheet.sheetId[templateName]; // multiple possible sheets

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

    /**
    * Insert row data into sheet that matches template name
    */

    // Check if sheet name exists for data insert
    const sheetObjectRequest = () => ({
      auth: jwtClient,
      spreadsheetId: spreadsheetId,
      includeGridData: false
    });
    let sheetDetails = await sheets.spreadsheets.get(sheetObjectRequest());
    let sheetNameExists = sheetDetails.data.sheets.find(sheet => {
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
      let newSheet = await sheets.spreadsheets.batchUpdate(addSheet());
      // Map 'replies' array to get sheetId
      let newSheetId = sheet => {
        let newSheet = {};
        sheet.data.replies.map(reply => newSheet.addSheet = reply.addSheet);
        return newSheet.addSheet.properties.sheetId;
      };

      // Add new sheetId to app spreadsheet info
      db.collection('app').doc(appKey).update({
          ['spreadsheet.sheetId.' + templateName]: newSheetId(newSheet)
      });

      // New Sheet Actions: add row header then row data
      await sheets.spreadsheets.values.update(addRow(rangeHeader)(sheetHeader));
      await sheets.spreadsheets.values.update(addRow(rangeData)(sheetDataRow));

    } // end 'else' add new sheet

  } catch(error) {
    
    console.error(logErrorInfo(error));

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

