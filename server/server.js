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
