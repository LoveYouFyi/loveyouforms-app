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

    const props = (() => {

      let props = { appKey: '', appFrom: '', appUrl: '', email: '', 
        webformId: '', templateName: '', templateData: {}, urlRedirect: '' }
      
      let getProps = ({ appKey, appFrom, appUrl, email, webformId, 
        templateName, templateData, urlRedirect  } = props) => ({
        data: {
          appKey, 
          createdDateTime: FieldValue.serverTimestamp(), 
          from: appFrom, 
          toUids: [ appKey ], 
          replyTo: email,
          webformId, 
          template: { 
            name: templateName, 
            data: templateData
          }
        },
        appUrl,
        urlRedirect
      });
   
      let templateDataWhitelist = [];

      let sanitizeValue = (value, maxLength) => 
        value.toString().trim().substr(0, maxLength);
    
      let setProp = (propKey, value, maxLength) => {
        let valueSanitized = sanitizeValue(value, maxLength);
        props[propKey] = valueSanitized; // add each prop to props, then also...
        if (templateDataWhitelist.includes(propKey)) {
          props.templateData[propKey] = valueSanitized;
        } 
      }

      let setTemplateDataWhitelist = array => {
        templateDataWhitelist = array;
      }

      return {
        setTemplateDataWhitelist: (array) => {
          setTemplateDataWhitelist(array)
        },
        getTemplateDataWhitelist: () => templateDataWhitelist, // fyi only - not used
        set: (propKey, value, maxLength) => {
          return setProp(propKey, value, maxLength);
        },
        get: () => getProps(),
      }
    })();


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
      props.set('appKey', app.id);
      props.set('appUrl', app.data().appInfo.appUrl); // must set before cors check
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
      res.set('Access-Control-Allow-Origin', props.get().appUrl);
      // end processing if url does not match (req.headers.origin = url)
      if (req.headers.origin !== props.get().appUrl) { 
        console.info(new Error('Origin Url does not match app url.'));
        return res.end();
      } 
    }

    /**
     *  Continue with form processing since passed valid app checks
     */

    // Url redirect: use global redirect by default unless overridden by form elements
    props.set('urlRedirect', globalConfig.urlRedirect.default);

    // Template name: global config unless form override
    let templateName = globalConfig.defaultTemplate.name;
    if (req.body.templateName) { templateName = req.body.templateName }
    props.set('templateName', templateName);

    // Template data whitelist: template props allowed to be added to email template
    let templateDataWhitelist = await db.collection('emailTemplate').doc(templateName).get();
    templateDataWhitelist = templateDataWhitelist.data().templateData;
    props.setTemplateDataWhitelist(templateDataWhitelist); 

    // App Info: set after template data whitelist or props will be excluded from template data
    let appInfoObject = app.data().appInfo;
    for (const prop in appInfoObject) {
      props.set(prop, appInfoObject[prop]);
    }

    // Form Elements: Add submitted to props with maxLength values
    let { ...formElements } = req.body; 
    // Collection formField contains maxLength values
    let formFields = await db.collection('formField').get();
    for (const doc of formFields.docs) {
      let maxLength = doc.data().maxLength;
      if (formElements.hasOwnProperty(doc.id)) {
        props.set(doc.id, formElements[doc.id], maxLength);
      }
    }

    // For serverTimestamp to work must first create new doc key then 'set' data
    const newKey = db.collection("formSubmission").doc();
    // update the new-key-record using 'set' which works for existing doc
    newKey.set(props.get().data)

    /**
     * Response
     */

    return res.status(200).send({
      // return response (even if empty) so client can finish AJAX success
      data: {
        redirect: props.get().urlRedirect
      }
    });

  } catch(error) {

    console.error(logErrorInfo(error));

    return res.status(500).send(responseErrorBasic('Error: Application error.'));

  } // end catch

});


// ANCHOR - Firestore To Sheets [Nested email template data]
exports.firestoreToSheets = functions.firestore.document('formSubmission/{formId}')
  .onCreate(async (snapshot, context) => {

  try {

    /**
    * Prepare row data values and get sheet header
    */

    const props = (() => {
      let rowData = {};
 
      let setRowData = (propKey, value) => {
        rowData[propKey] = value;
      }

      let getRowDataValues = () => {
        return [( Object.values(rowData) )]; // sheets requires nested as array
      }

      return {
        setRowData: (propKey, value) => {
          return setRowData(propKey, value);
        },
        getRowDataValues: () => getRowDataValues(),
      }
    })();

    // Form Submission: values from Snapshot.data()
    let { appKey, createdDateTime, template: { data: { ...templateData }, 
      name: templateName  }, webformId } = snapshot.data();

    // Template: two sort-ordered arrays of strings
    // sheetHeader is sorted according to desired sheets visual
    // templateData is sorted to match the order of the sheetHeader
    let emailTemplate = await db.collection('emailTemplate').doc(templateName).get();

    // Header fields for sheet requires to be nested as array
    let sheetHeader = [( emailTemplate.data().sheetHeader )]; 
   
    /** [Start] Row Data: Sorted **********************************************/
    // Add/set row data to props object to match sort order of sheet header 
    // 1) Start with date, time, and, webformId for all template types
    // date/time: timezone string defined by momentjs.com/timezone: https://github.com/moment/moment-timezone/blob/develop/data/packed/latest.json
    const dateTime = createdDateTime.toDate(); // toDate() is firebase method
    props.setRowData('createdDate', moment(dateTime).tz(templateData.appTimeZone).format('L'));
    props.setRowData('createdTime', moment(dateTime).tz(templateData.appTimeZone).format('h:mm A z'));
    props.setRowData('webformId', webformId);
    // 2) Add templateData sorted elements with empty string values so the order 
    // of props in rowData will match sheetHeader order
    emailTemplate.data().templateData.map(e => props.setRowData([e], ""));
    // 3) Update sort-ordered props with the formSubmission data values
    for (const property in templateData) {
      props.setRowData(property, templateData[property]);
    }
    /** [End] Row Data: Sorted ************************************************/


    /**
    * Prepare to insert data-row in app-specific spreadsheet
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
      // Update Google Sheets Data
      await sheets.spreadsheets.batchUpdate(blankRowInsertAfterHeader(sheetId));
      await sheets.spreadsheets.values.update(addRow(rangeData)(props.getRowDataValues()));

    } else {

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

      // Add sheet: returns new sheet properties
      let newSheet = await sheets.spreadsheets.batchUpdate(addSheet());

      // Get new sheetId and add to app spreadsheet info
      // newSheet returns 'data' object with properties:
      // prop: spreadsheetId
      // prop: replies[0].addSheet.properties (sheetId, title, index, sheetType, gridProperties { rowCount, columnCount }
      // Map replies array array to get sheetId
      let newSheetProps = {};
      newSheet.data.replies.map(reply => newSheetProps.addSheet = reply.addSheet); 
      let newSheetId = newSheetProps.addSheet.properties.sheetId;

      // Add new sheetId to app spreadsheet info
      db.collection('app').doc(appKey).update({
          ['spreadsheet.sheetId.' + templateName]: newSheetId
      });

      // New Sheet Actions: add rows for header, then data
      await sheets.spreadsheets.values.update(addRow(rangeHeader)(sheetHeader));
      return sheets.spreadsheets.values.update(addRow(rangeData)(props.getRowDataValues()));

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

