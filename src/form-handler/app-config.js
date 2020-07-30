/*------------------------------------------------------------------------------
  App Config
  Processes validations, and if all pass, returns object with:
    app data, globalApp data, and messages
------------------------------------------------------------------------------*/

/*-- Dependencies ------------------------------------------------------------*/
const { queryDoc } = require('./../utility');

/*------------------------------------------------------------------------------
  Messages: returns app-specific or globalApp based on config settings
------------------------------------------------------------------------------*/
const messagesAppVsGlobal = (app, globalApp) => {
  // global boolean 0/false, 1/true, or '2' bypass global & use app boolean
  return (
    (globalApp.condition.messageGlobal === 1
      || (globalApp.condition.messageGlobal === 2
          && !!app.condition.messageGlobal)
    ) ? globalApp.message
      : app.message
  )
}

/*------------------------------------------------------------------------------
  Submit Form Boolean: To check if submit form is enabled/disabled
  global boolean 0/false, 1/true, or '2' bypass global to use app boolean
------------------------------------------------------------------------------*/
const submitFormBoolean = (app, globalApp) => {
  // If disabled
  if (globalApp.condition.submitForm === 0
      || (globalApp.condition.submitForm === 2
          && !app.condition.submitForm)
  ) {
    console.warn(`Form submit disabled for app "${app.appInfo.appName}"`);
    return false;
  } else {
    return true;
  }
}

/*------------------------------------------------------------------------------
  App Config:
  If app does not exist return false... Else return app settings object { }
  Check if cors authorized app, and form submit enabled
------------------------------------------------------------------------------*/
module.exports = async (formSubmission) => {

  // App & App Check
  const app = await queryDoc('app', formSubmission.appKey);
  // Stop processing if app key does not exist
  if (!app) {
    console.warn('App Key does not exist.');
    return false;
  }

  const globalApp = await queryDoc('global', 'app');
  const messages = messagesAppVsGlobal(app, globalApp);
  const submitFormEnabled = submitFormBoolean(app, globalApp);

  //////////////////////////////////////////////////////////////////////////////
  // Return object
  //////////////////////////////////////////////////////////////////////////////
  return {
    app,
    globalApp,
    messages,
    submitFormEnabled
  }

}
