/*------------------------------------------------------------------------------
  Form-Handler HTTP Cloud Function
  Receives data sent by form submission and creates database entry
  Terminate HTTP cloud functions with res.redirect(), res.send(), or res.end()
------------------------------------------------------------------------------*/

/*-- Dependencies ------------------------------------------------------------*/
const { logErrorInfo } = require("./../utility");
const getAppSettings = require('./app-settings');
const getFormResults = require('./form-results');

/*------------------------------------------------------------------------------
  Export Form Handler Function
------------------------------------------------------------------------------*/
module.exports = ({ admin }) => async (req, res) => {
  const db = admin.firestore();
  // Stop processing if content-type is 'undefined' or not 'text/plain'
  if (typeof req.headers['content-type'] === 'undefined'
    || req.headers['content-type'].toLowerCase() !== 'text/plain') {
    console.warn(`Request header 'content-type' must be 'text/plain'`);
    res.end();
  }

  // Form submission string as object, req.body should be json formatted string
  const formSubmission = JSON.parse(req.body);

  const messages = {}; // declared here so catch has access to config messages

  try {
    // Settings returns {} props
    const appSettings = await getAppSettings(req, res, db, formSubmission);
    // If app does not exist stop processing
    if (!appSettings) {
      return res.end();
    }
    // Set messages (taken from 'app' or 'globalApp' based on config)
    Object.assign(messages, appSettings.messages);
//    messages = appSettings.messages;

    //////////////////////////////////////////////////////////////////////////////
    // CORS Validation
    // Stop cloud function if check does not pass
    // Global boolean 0/false, 1/true, or '2' bypass global to use app boolean
    //////////////////////////////////////////////////////////////////////////////
    if (appSettings.globalApp.condition.corsBypass === 0
        || (appSettings.globalApp.condition.corsBypass === 2
            && !appSettings.app.condition.corsBypass)
      ) {
      // url requests restricted to match the app
      res.setHeader('Access-Control-Allow-Origin', appSettings.app.appInfo.appUrl);
      // end processing if app url does not match req.headers.origin url
      if (req.headers.origin !== app.appInfo.appUrl) {
        console.warn('CORS Access Control: Origin Url does not match App Url.');
        // no error response sent because request not from approved app
        return res.end();
      }
    } else {
      // allow all so localhost (or any source) can submit requests
      res.setHeader('Access-Control-Allow-Origin', '*');
    }


    // If submit form disabled
    if (!appSettings.submitForm) {
      console.log("error $$$$$$$$$$$$$$$$$$$$$$$$$$$ ", messages.error);
      return res.status(200).send({
        data: {
          message: messages.error
        }
      });
    }

    ////////////////////////////////////////////////////////////////////////////
    // Database Entry: add form submission to database
    ////////////////////////////////////////////////////////////////////////////
    const formResults = await getFormResults(req, admin, db, formSubmission,
      appSettings.app, appSettings.globalApp);
    // For serverTimestamp to work must first create new doc key then 'set' data
    const newKeyRef = db.collection('submitForm').doc();
    // update the new-key-record using 'set' which works for existing doc
    newKeyRef.set(formResults.data);

    ////////////////////////////////////////////////////////////////////////////
    // Response: return object (even if empty) so client can finish AJAX success
    ////////////////////////////////////////////////////////////////////////////
    console.log("formResults $$$$$$$$$$$$$$$$$$$$$$$$$$$ ", formResults.urlRedirect);
    console.log("success $$$$$$$$$$$$$$$$$$$$$$$$$$$ ", messages.success);

    return res.status(200).send({
      data: {
        redirect: formResults.urlRedirect,
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