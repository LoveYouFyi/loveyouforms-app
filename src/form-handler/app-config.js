/*------------------------------------------------------------------------------
  App Config
  Processes validations, and if all pass returns object with app, globalApp,
  and messages
------------------------------------------------------------------------------*/

/*------------------------------------------------------------------------------
  App
------------------------------------------------------------------------------*/
const getApp = async (db, formSubmission) => {
  const gotApp = await db.collection('app').doc(formSubmission.appKey).get();
  return gotApp.data();
}

/*------------------------------------------------------------------------------
  Global App
------------------------------------------------------------------------------*/
const getGlobalApp = async (db) => {
  const gotGlobalApp = await db.collection('global').doc('app').get();
  return gotGlobalApp.data();
}

/*------------------------------------------------------------------------------
  Messages: app-specific or globalApp based on config settings
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
  Submit Form Boolean (enabled/disabled):
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
const appConfig = async (db, formSubmission) => {

  // App & App Check
  const app = await getApp(db, formSubmission);
  // If app key does not exist...
  if (!app) {
    console.warn('App Key does not exist.');
    // no error message sent to client because submit not from approved app
    return false;
  }

  const globalApp = await getGlobalApp(db);
  const messages = messagesAppVsGlobal(app, globalApp);
  const submitFormEnabled = submitFormBoolean(app, globalApp);

  //////////////////////////////////////////////////////////////////////////////
  // If above returns were not triggered then return object
  //////////////////////////////////////////////////////////////////////////////
  return ({
    app,
    globalApp,
    messages,
    submitFormEnabled
  });

}

module.exports = appConfig;