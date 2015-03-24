// Upcoming Farms Adelaide -- server

// Allow the browser to load Font Awesome resources from CDN:
BrowserPolicy.content.allowOriginForAll('*.bootstrapcdn.com');

Meteor.publish("directory", function () {
  return Meteor.users.find({}, {fields: {emails: 1, profile: 1}});
});

Meteor.publish("parties", function () {
  return Parties.find(
    {$or: [{"public": true}, {invited: this.userId}, {owner: this.userId}]});
});

// Required to send email:
Meteor.startup(function () {
  process.env.MAIL_URL = "smtp://" + process.env.MAIL_USER + ":' + encodeURIComponent(process.env.MAIL_PASSWORD) + "@smtp.gmail.com:465";
//  process.env.MAIL_URL = "smtp://username%40gmail.com:InsertYourGoogleAuthToken@smtp.gmail.com:465/";
}
