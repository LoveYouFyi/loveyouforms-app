/*------------------------------------------------------------------------------
  Firestore-to-Sheets Trigger Cloud Function
  Listens for new 'submitForm' collection docs and adds data to google sheets.
  If required, creates new sheet(tab) and row header.
------------------------------------------------------------------------------*/

/*-- Dependencies ------------------------------------------------------------*/
const { queryDoc, logErrorInfo } = require('./../utility');
const getFormDataAndSheetHeaderRows =
  require('./form-data-and-sheet-header-rows');
const processGoogleSheetSync = require('./google-sheet-sync');

/*------------------------------------------------------------------------------
  Export Firestore To Sheets Function
------------------------------------------------------------------------------*/
module.exports = () => async (snapshot, context) => {

  // Form Results
  const { appKey } = snapshot.data();

  try {
    // App: used in multiple child files so get once here
    const app = await queryDoc('app', appKey);

    // Form Data and Sheet Header Rows
    const formDataAndSheetHeaderRows =
      await getFormDataAndSheetHeaderRows(snapshot, app);
    const formDataRow = formDataAndSheetHeaderRows.formDataRowSorted;
    const sheetHeaderRow = formDataAndSheetHeaderRows.sheetHeaderRowSorted;

    ////////////////////////////////////////////////////////////////////////////
    // Process Google Sheets Sync
    ////////////////////////////////////////////////////////////////////////////
    await processGoogleSheetSync(snapshot, app, formDataRow, sheetHeaderRow);

  } catch(error) {

    console.error(logErrorInfo(error));

  }

}
