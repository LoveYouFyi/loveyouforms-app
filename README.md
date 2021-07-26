# LoveYouForms - Node.js Package

## Primary codebase for the RESTful LoveYouForms JavaScript cloud app that handles form submissions for one website or 1,000 using Firebase.

### Features
* Google Sheets Sync
* Email Notifications
* Spam Filter with Akismet
* Deployed to cloud Firebase, makes use of Firestore database

# Video Demo ❤️ **<a href="https://player.vimeo.com/video/579393677">for LoveYouForms here</a>** ❤️

### This repo is the primary codebase, find the app-wrapper at ❤️ **<a href="https://github.com/LoveYouFyi/loveyouforms">loveyouforms</a>** ❤️ 

# Motivation for LoveYouForms

To make it fast and simple to capture, handle, and view form submissions for **unlimited web forms** of **unlimited websites** &mdash; **from a single cloud application** that requires minimal maintenance and cost.

You get significant time-savings compared to developing, and deploying or maintaining
a new, and separate form-handling API for each web-app.

## What is LoveYouForms?

### Functional Explanation

Your own form handling application:

* **Manage Unlimited Websites** &mdash; each with its own settings, email recipients, and Google Sheets spreadsheet sync.
* **Form Submissions** &mdash; captures and saves form-submitted data to your database.
* **Email Sending** &mdash; sends emails with the form data to one or more email addresses.
* **Google Sheets** &mdash; syncs form submissions to Google Sheets so you have a spreadsheet to view all form submissions.
* **Spam Filter** &mdash; option for using Akismet prevents emails from being sent when a form submission is flagged as spam, but still syncs the data to Google Sheets for your periodic review in case a legitimate submission was mistakenly flagged as spam.

### Technical Explanation

It is a **Node.js application** which is served as cloud functions on the **Google Firebase platform**. It uses the scalable NoSQL cloud **Firestore database** of the Firebase platform. Cloud funtions make use of the **Google API** to sync form data to **Google Sheets** spreadsheets. Emails are sent using the **SMTP Email Provider API** of your choice (such as Sendgrid). **Spam filtering with Akismet** optionally built in.

# Why Use LoveYouForms?

The app runs on Google's Firebase platform. So the servers, Node.js environment, and database are managed by them, and scaling is automated.

* **Free or Cost Effective** &mdash; although you need to supply your credit card to Google Firebase to activate all the functionality of the application's cloud functions, you may never pay anything for usage since their free tier is extremely generous. Google Sheets sync costs nothing unless you are processing an extremely high number of form submissions. Sendgrid's free tier allows 100 emails per day. For an unlimited number of websites, you should be able to process up to a combined 100 form submissions per day, or 3,000 emails per month without paying anything.
* **Minimal Maintenace** &mdash; leverages stable and fully-managed backend systems for minimal maintenance by you: Firebase, Google Sheets, Sendgrid (or your choice of email provider), Akismet.
* **Performance** &mdash; never worry about being able to handle volume, or scaling.


# When to Use LoveYouForms?

Use it for websites which primary motivation is to capture form submissions from anonymous visitors, that is, not authenticated / not logged in. Use it for capturing data from contact forms, lead-generation forms, email addresses, feedback, etc.

Use it when relying on client-side data validation serves your needs.

The app is not presently intended for use when needs require robust server-side data validation. Though this can be achieved through further development.
