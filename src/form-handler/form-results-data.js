/*------------------------------------------------------------------------------
  Form Fields Data

------------------------------------------------------------------------------*/

/*-- Dependencies ------------------------------------------------------------*/
const path = require('path');
const { sortObjectsAsc, objectValuesByKey } =
  require(path.join(__dirname, "../utility"));

/*-- Cloud Function ----------------------------------------------------------*/
const spamCheckAkismet = require('./spam-check-akismet');

const formResultsData = async (req, admin, db, formSubmission, app, globalApp) => {

    ////////////////////////////////////////////////////////////////////////////
    // Props/Fields
    // Compile database and form fields to be handled as object entries, and
    // add to structured object
    ////////////////////////////////////////////////////////////////////////////
    const appKey = app.id;
    const appInfo = app.appInfo;

    //
    // Form Field Defaults: select from db all default fields
    // Return Object of docs
    //
    const formFieldsDefaultRef = await db.collection('formField')
      .where('default', '==', true).get();

    const formFieldsDefault = formFieldsDefaultRef.docs.reduce((a, doc) => {
      a[doc.id] = doc.data().value;
      return a;
    }, {});

    //
    // Props All: consolidate props and fields last-in overwrites previous
    //
    const propsAll = { appKey, ...formFieldsDefault, ...formSubmission, ...appInfo };

    ////////////////////////////////////////////////////////////////////////////
    // Props Allowed Entries: reduce to allowed props
    //
    // Remove the fields not used for database or code actions to:
    // 1) prevent database errors due to querying docs using disallowed values
    //    e.g. if html <input> had name="__anything__"
    //    doc limits: https://firebase.google.com/docs/firestore/quotas#limits
    // 2) only include fields used for database or code actions
    //
    // Props Whitelist: compiled from database
    // Database Schema
    //   formField/'all required' --> formFieldsRequired
    //   formTemplate/'templateName'/fields --> formTemplateFields
    //   app/'appKey'/appInfo.*props --> appInfo

    //
    // Form Fields Required: fields required for cloud function to work
    // Return Array of field names
    //
    const formFieldsRequiredRef = await db.collection('formField')
      .where('required', '==', true).get();

    const formFieldsRequired = formFieldsRequiredRef.docs.reduce((a, doc) => {
      a.push(doc.id);
      return a;
    }, []);

    //
    // Form Template Fields:
    // Array of field for submitForm/.../template.data used by 'trigger email' extension
    //
    const formTemplateRef = await db.collection('formTemplate')
      .doc(propsAll.templateName).get();

    const formTemplateFieldsSorted = objectValuesByKey(
      sortObjectsAsc(formTemplateRef.data().fields, 'position'), 'id');

    // Props Whitelist:
    // Array of prop keys allowed for database or code actions last-in overwrites previous
    const propsWhitelist = [ ...formFieldsRequired, ...formTemplateFieldsSorted,
      ...Object.keys(appInfo)
    ];

    //
    // Props Allowed Entries: entries used for database or code actions
    // Return Object
    //
    const propsAllowedEntries = Object.entries(propsAll).reduce((a, [key, value]) => {
      if (propsWhitelist.includes(key)) {
        a[key] = value;
      }
      return a;
    }, {});
    //
    // [END] Props Allowed Entries: reduce to allowed props
    ////////////////////////////////////////////////////////////////////////////

    ////////////////////////////////////////////////////////////////////////////
    // Props Set & Get
    //
    const props = (() => {

      const trim = value => value.toString().trim();
      const props =  { toUids: '', templateData: {} }

      // compare database fields with form-submitted props and build object
      const setProps = propsToParse =>
        Object.entries(propsToParse).forEach(([key, value]) => {
          value = trim(value);
          props[key] = value;
          // toUids: appKey value unless if spam flagged is [ akismet spam message ]
          if (key === 'appKey') {
            props.toUids = value;
          } else if (key === 'spam') {
            // if spam then override toUids value so email is not sent
            value === 'true' && (props.toUids = "SPAM_SUSPECTED_DO_NOT_EMAIL");
          }
          // Form Template Fields: Whitelist check [START]
          if (formTemplateFieldsSorted.includes(key)) {
            props.templateData[key] = value;
          }
          // Form Template Fields: Whitelist check [END]
        });

      const getProps = ({ templateData, urlRedirect = false, ...key } = props) => ({
        data: {
          appKey: key.appKey,
          createdDateTime: admin.firestore.FieldValue.serverTimestamp(),
          from: key.appFrom,
          ...key.spam && { spam: key.spam }, // only defined if akismet enabled
          toUids: [ key.toUids ],
          replyTo: templateData.email,
          template: {
            name: key.templateName,
            data: templateData
          }
        },
        urlRedirect: urlRedirect
      });

      return {
        set: props => {
          setProps(props);
        },
        get: () => {
          return getProps();
        }
      };
    })();
    // Set allowed props
    props.set(propsAllowedEntries);

    const propsForSpamCheck = props.get().data;
    console.log("propsForSpam $$$$$$$$$$$$$$$$$$$$$$$$$$$$$ ", propsForSpamCheck);
    const spamCheckResults = await spamCheckAkismet(req, formTemplateRef, propsForSpamCheck, app, globalApp);
    console.log("spamCheck $$$$$$$$$$$$$$$$$$$$$$$$$$$$ ", spamCheckResults);
    props.set(spamCheckResults);
    //
    // [END] Props Set & Get
    ////////////////////////////////////////////////////////////////////////////

    return props.get().data

}

module.exports = formResultsData;