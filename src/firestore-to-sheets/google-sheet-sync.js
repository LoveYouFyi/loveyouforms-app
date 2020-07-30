/*------------------------------------------------------------------------------
  Google Sheet Sync
  Process sync with app's google sheet
------------------------------------------------------------------------------*/

/*-- Dependencies ------------------------------------------------------------*/
const { queryDocUpdate } = require('./../utility');
// Google Sheets Auth + API
// service-account credentials: manually download file using Firebase console;
// credentials are used by cloud function to authenticate with Google Sheets API
const serviceAccount = require('./../../../../service-account.json');
const { google } = require('googleapis'); // Google API
const googleAuth = new google.auth.JWT({ // JWT Authentication (for google sheets)
  email: serviceAccount.client_email, // <--- CREDENTIALS
  key: serviceAccount.private_key, // <--- CREDENTIALS
  scopes: ['https://www.googleapis.com/auth/spreadsheets'] // read and write sheets
});
const googleSheets = google.sheets('v4'); // Google Sheets

/*------------------------------------------------------------------------------
  Add Row Values to Google Sheet
------------------------------------------------------------------------------*/
const addRowValues = (spreadsheetId, range, values) => ({
  auth: googleAuth,
  spreadsheetId: spreadsheetId,
  ...range && { range }, // e.g. "contactDefault!A2"
  valueInputOption: "RAW",
  requestBody: {
    ...values && { values }
  }
});

/*------------------------------------------------------------------------------
  Add Blank Row After Header
  sheetId argument: existing vs new sheet
------------------------------------------------------------------------------*/
const addBlankRowAfterHeader = (spreadsheetId, sheetId) => ({
  auth: googleAuth,
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

/*------------------------------------------------------------------------------
  Add Sheet:
  Request object for adding sheet to existing spreadsheet
  'addSheet' request object returns new sheet properties
  Get new sheetId and add to app spreadsheet info
  newSheet returns 'data' object with properties:
    prop: spreadsheetId
    prop: replies[0].addSheet.properties (
    sheetId, title, index, sheetType, gridProperties { rowCount, columnCount } )
------------------------------------------------------------------------------*/
const addSheet = (spreadsheetId, templateName) => ({
  auth: googleAuth,
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

/*------------------------------------------------------------------------------
  Check if Sheet Name Exists
------------------------------------------------------------------------------*/
const checkIfSheetNameExists = async (spreadsheetId, templateName) => {
  // Sheet object to check
  const sheetObjectRequest = {
    auth: googleAuth,
    spreadsheetId: spreadsheetId,
    includeGridData: false
  };
  // Check if sheet name exists for data insert
  const sheetDetails = await googleSheets.spreadsheets.get(sheetObjectRequest);
  const sheetNameExists = sheetDetails.data.sheets.find(sheet => {
    // if sheet name exists returns sheet 'properties' object, else is undefined
    return sheet.properties.title === templateName;
  });

  return sheetNameExists ? true : false;
}

/*------------------------------------------------------------------------------
  Sheet Id
------------------------------------------------------------------------------*/
const getSheetId = sheet => {
  const sheetDetails = {};
  // sheet.data.replies contains the new sheet props
  sheet.data.replies.map(reply => sheetDetails.addSheet = reply.addSheet);
  // Sheet id
  return sheetDetails.addSheet.properties.sheetId;
};

/*------------------------------------------------------------------------------
  Google Sheet Sync
  Process sync with google sheet corresponding to application
------------------------------------------------------------------------------*/
module.exports = async (snapshot, app, formDataRow, sheetHeaderRow) => {

  // Form Results
  const { appKey, template: { name: templateName  } } = snapshot.data();

  // Application spreadsheetId and sheetId of the form template
  const spreadsheetId = app.service.googleSheets.spreadsheetId; // one spreadsheet per app
  const sheetId = app.service.googleSheets.sheetId[templateName]; // multiple possible sheets

  //////////////////////////////////////////////////////////////////////////////
  // Insert data-row into sheet that matches template name, if the sheet does
  // not exist then create it
  //////////////////////////////////////////////////////////////////////////////

  // Authorize prior to calling functions that access sheets
  await googleAuth.authorize();

  const sheetNameExists = await checkIfSheetNameExists(spreadsheetId,
    templateName);

  // Sheet ranges for adding header or data-row
  const rangeHeader =  `${templateName}!A1`; // e.g. "contactDefault!A1"
  const rangeData =  `${templateName}!A2`; // e.g. "contactDefault!A2"

  // if sheet name exists, insert data-row
  if (sheetNameExists) {
    // Insert into spreadsheet a blank row
    await googleSheets.spreadsheets.batchUpdate(addBlankRowAfterHeader(spreadsheetId, sheetId));
    // Overwrite blank row with the data
    await googleSheets.spreadsheets.values.update(addRowValues(spreadsheetId, rangeData, formDataRow));

  } else {
    // Create new sheet + insert header + insert data

    // Add new sheet
    const newSheet = await googleSheets.spreadsheets.batchUpdate(addSheet(spreadsheetId, templateName));
    // Add new sheetId to database app spreadsheet info (or overwrite existing if name is same)
    queryDocUpdate(
      'app',
      appKey,
      {['service.googleSheets.sheetId.' + templateName]: getSheetId(newSheet)}
    )

    // New Sheet Actions: add row header then row data
    await googleSheets.spreadsheets.values.update(
      addRowValues(spreadsheetId, rangeHeader, sheetHeaderRow)
    );
    await googleSheets.spreadsheets.values.update(addRowValues(spreadsheetId, rangeData, formDataRow));

  } // end 'else'

}
