// All Tomorrow's Farms -- data model
// Loaded on both the client and the server

///////////////////////////////////////////////////////////////////////////////
// Farms -- based on Meteor Parties example app

/*
  Each farm is represented by a document in the Parties collection:
    owner: user id
    x, y: Number (screen coordinates in the interval [0, 1])
    title, description: String
    startdatetime: String,
    public: Boolean
    invited: Array of user id's that are invited (only if !public)
    rsvps: Array of objects like {user: userId, rsvp: "yes"} (or "no"/"maybe")
*/
Parties = new Mongo.Collection("parties");

// SuperUser can view/edit/modify any farm.
getSuperuserId = function() {
  if (Meteor.isServer) {
    console.log('Server getSuperuserId() -> ' + process.env.SUPERUSER_ID);
    return process.env.SUPERUSER_ID;
  }
  // Client side calls the server (sync):
  // return Meteor.call('getSuperuserId'); // Sync call did not work??
  var sessionSuperuserId = Session.get('superuserId');
  if (sessionSuperuserId) {
    console.log('Client getSuperuserId() -> ' + sessionSuperuserId);   
    return sessionSuperuserId;
  }

  // Async call saves superuserId in client session:
  Meteor.call('getSuperuserId', function(err, result) {
    // cache the result in the Session
    Session.set('superuserId', result);
    console.log('Client Meteor.call("getsuperuserId") -> ' + result);
  });
  return Session.get('superuserId');
};

Parties.allow({
  insert: function (userId, party) {
    return false; // no cowboy inserts -- use createParty method
  },
  update: function (userId, party, fields, modifier) {
    if (userId !== party.owner && userId !== getSuperuserId())
      return false; // not the owner or superuser

    var allowed = ["title", "startdatetime", "description", "x", "y"];
    if (_.difference(fields, allowed).length)
      return false; // tried to write to forbidden field

    // A good improvement would be to validate the type of the new
    // value of the field (and if a string, the length.) In the
    // future Meteor will have a schema system to makes that easier.
    return true;
  },
  remove: function (userId, party) {
    // You can only remove parties that you created (NOT and nobody is going to).
    return userId === party.owner || userId === getSuperuserId(); //  && attending(party) === 0;
  }
});

attending = function (party) {
  return (_.groupBy(party.rsvps, 'rsvp').yes || []).length;
};

var NonEmptyString = Match.Where(function (x) {
  check(x, String);
  return x.length !== 0;
});

var Coordinate = Match.Where(function (x) {
  check(x, Number);
  return x >= 0 && x <= 1;
});

createParty = function (options) {
  var id = Random.id();
  Meteor.call('createParty', _.extend({ _id: id }, options));
  return id;
};

Meteor.methods({
  // options should include: title, startdate, starttime, description, x, y, public
  createParty: function (options) {
    check(options, {
      title: NonEmptyString,
      startdatetime: NonEmptyString,
      description: NonEmptyString,
      x: Coordinate,
      y: Coordinate,
      public: Match.Optional(Boolean),
      _id: Match.Optional(NonEmptyString)
    });

    if (options.title.length > 100)
      throw new Meteor.Error(413, "Title too long");
    if (options.description.length > 1000)
      throw new Meteor.Error(413, "Description too long");
    if (! this.userId)
      throw new Meteor.Error(403, "You must be logged in");

    var id = options._id || Random.id();
    Parties.insert({
      _id: id,
      owner: this.userId,
      x: options.x,
      y: options.y,
      title: options.title,
      startdatetime: options.startdatetime,
      description: options.description,
      public: !! options.public,
      invited: [],
      rsvps: []
    });
    return id;
  },

  invite: function (partyId, userId) {
    check(partyId, String);
    check(userId, String);
    var party = Parties.findOne(partyId);
    if (!party || (this.userId !== party.owner && this.userId !== getSuperuserId()))
      throw new Meteor.Error(404, "No such farm");
    if (party.public)
      throw new Meteor.Error(400,
                             "That farm is public. No need to invite people.");
    if (userId !== party.owner && !_.contains(party.invited, userId)) {
      Parties.update(partyId, { $addToSet: { invited: userId } });

      var partyHost = Meteor.users.findOne(this.userId);
      var invitee = Meteor.users.findOne(userId);
      var from = contactEmail(partyHost);
      var to = contactEmail(invitee);
      var fromDisplayName = displayName(partyHost);
      var toDisplayName = displayName(invitee);

      if (Meteor.isServer && to) {
        // This code only runs on the server. If you didn't want clients
        // to be able to see it, you could move it to a separate file.
        Email.send({
          from: "gerg.bowering@gmail.com",
          to: to,
          replyTo: from || undefined,
          subject: "FARM: " + party.title + " " + party.startdatetime,
          text:
"Hi " + toDisplayName +
"\n\nI just invited you to '" + party.title + "' on Upcoming Farms Adelaide." +
"\n\nCome check it out: " + Meteor.absoluteUrl() +
"\n\n\n" + fromDisplayName + "\n"
        });
      }
    }
  },

  rsvp: function (partyId, rsvp) {
    check(partyId, String);
    check(rsvp, String);
    if (!this.userId)
      throw new Meteor.Error(403, "You must be logged in to RSVP");
    if (!_.contains(['yes', 'no', 'maybe'], rsvp))
      throw new Meteor.Error(400, "Invalid RSVP");
    var party = Parties.findOne(partyId);
    if (!party)
      throw new Meteor.Error(404, "No such farm");
    if (!party.public &&
        this.userId !== getSuperuserId() &&
        this.userId !== party.owner &&
        !_.contains(party.invited, this.userId))
      // private, but let's not tell this to the user
      throw new Meteor.Error(403, "No such farm");

    var rsvpIndex = _.indexOf(_.pluck(party.rsvps, 'user'), this.userId);
    if (rsvpIndex !== -1) {
      // update existing rsvp entry

      if (Meteor.isServer) {
        // update the appropriate rsvp entry with $
        Parties.update(
          {_id: partyId, "rsvps.user": this.userId},
          {$set: {"rsvps.$.rsvp": rsvp}});
      } else {
        // minimongo doesn't yet support $ in modifier. as a temporary
        // workaround, make a modifier that uses an index. this is
        // safe on the client since there's only one thread.
        var modifier = {$set: {}};
        modifier.$set["rsvps." + rsvpIndex + ".rsvp"] = rsvp;
        Parties.update(partyId, modifier);
      }

      // Possible improvement: send email to the other people that are
      // coming to the party.
    } else {
      // add new rsvp entry
      Parties.update(partyId,
                     {$push: {rsvps: {user: this.userId, rsvp: rsvp}}});
    }
  },

  // This is a synchronous method that just exposes the value of the SUPERUSER_ID environment variable.
  getSuperuserId: function() {
    if (Meteor.isServer) {
      return process.env.SUPERUSER_ID;
    } else {
      return Session.get('superuserId');
    }
  }
});

///////////////////////////////////////////////////////////////////////////////
// Users

displayName = function (user) {
  if (user.profile && user.profile.name)
    return user.profile.name;
  return user.emails[0].address;
};

var contactEmail = function (user) {
  if (user.emails && user.emails.length)
    return user.emails[0].address;
  if (user.services && user.services.google && user.services.google.email)
    return user.services.google.email;
  return null;
};

