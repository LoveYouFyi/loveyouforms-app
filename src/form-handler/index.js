/*------------------------------------------------------------------------------
  Form-Handler HTTP Cloud Function
  Receives data sent by form submission and creates database entry
  Terminate HTTP cloud functions with res.redirect(), res.send(), or res.end()
------------------------------------------------------------------------------*/

/*-- Cloud Function ----------------------------------------------------------*/
const { logErrorInfo } = require("./../utility");
const appValidate = require('./app-validate');
const formResults = require('./form-results');

module.exports = ({ admin }) => async (req, res) => {
  const db = admin.firestore();
  let messages; // declared here so catch has access to config messages
  // Stop processing if content-type is 'undefined' or not 'text/plain'
  if (typeof req.headers['content-type'] === 'undefined'
    || req.headers['content-type'].toLowerCase() !== 'text/plain') {
    console.warn(`Request header 'content-type' must be 'text/plain'`);
    res.end();
  }

  // Form submission string as object, req.body should be json formatted string
  const formSubmission = JSON.parse(req.body);

  try {

    const validRequest = await appValidate(req, res, db, formSubmission);
    const app = validRequest.app;
    const globalApp = validRequest.globalApp; // declared here for akismet
    messages = validRequest.messages; // either 'app' or 'globalApp' messages

    ////////////////////////////////////////////////////////////////////////////
    // Database Entry: add form submission to database
    ////////////////////////////////////////////////////////////////////////////
    const formHandlerResults = await formResults(req, admin, db, formSubmission,
      app, globalApp);
    // For serverTimestamp to work must first create new doc key then 'set' data
    const newKeyRef = db.collection('submitForm').doc();
    // update the new-key-record using 'set' which works for existing doc
    newKeyRef.set(formHandlerResults.data);

    ////////////////////////////////////////////////////////////////////////////
    // Response: return object (even if empty) so client can finish AJAX success
    ////////////////////////////////////////////////////////////////////////////
    return res.status(200).send({
      data: {
        redirect: formHandlerResults.urlRedirect,
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

} // end module.exports