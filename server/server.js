// Upcoming Farms Adelaide -- server

// Allow the browser to load Font Awesome resources from CDN:
BrowserPolicy.content.allowOriginForAll('*.bootstrapcdn.com');

Meteor.publish("directory", function () {
  return Meteor.users.find({}, {fields: {emails: 1, profile: 1}});
});

Meteor.publish("parties", function () {
  // The SuperUser can view all parties (typically they can do this directly via the database anyway)
  if (this.userId && this.userId === process.env.SUPERUSER_ID)
    return Parties.find();

  // Filter parties visibility according to public/private and for private parties only owner and invites guests can see it.
  return Parties.find(
    {$or: [{"public": true}, {invited: this.userId}, {owner: this.userId}]});
});

// Required to send email:
Meteor.startup(function () {
  console.log('Meteor.startup()...');
  // port 456 / 587
  process.env.MAIL_URL = 'smtp://' + process.env.MAIL_USER + ':' + encodeURIComponent(process.env.MAIL_PASSWORD) + '@smtp.gmail.com:465';
//  process.env.MAIL_URL = 'smtp://username%40gmail.com:InsertYourGoogleAuthToken@smtp.gmail.com:465/';
  // console.log(process.env);
});

