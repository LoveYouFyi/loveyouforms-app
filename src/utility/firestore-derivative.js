
/*-- Dependencies ------------------------------------------------------------*/
const moment = require('moment-timezone'); // Timestamp formats and timezones

/*------------------------------------------------------------------------------
 Date and Time from firestore timestamp
------------------------------------------------------------------------------*/
module.exports.dateTime = (firestoreTimestamp, app) => {

  // timezone 'tz' string defined by momentjs.com/timezone:
  // https://github.com/moment/moment-timezone/blob/develop/data/packed/latest.json
  const dateTime = firestoreTimestamp.toDate(); // toDate() is firebase method
  const createdDate = moment(dateTime).tz(app.appInfo.appTimeZone).format('L');
  const createdTime =
    moment(dateTime).tz(app.appInfo.appTimeZone).format('h:mm A z');

  return {
    date: createdDate,
    time: createdTime
  }
}

