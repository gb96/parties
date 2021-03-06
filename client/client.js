// Upcoming Farms -- client

Meteor.subscribe("directory");
Meteor.subscribe("parties");

var sizeX = 960; // map width
var sizeY = 820; // map height

// If no farm selected, or if the selected party was deleted, select one.
Meteor.startup(function () {
  console.log('Client startup()');

  // Not sure best place to call this... calling it twice!
  getSuperuserId();

  Deps.autorun(function () {
    // Flag mobile / desktop using mystor:meteor-device-detection
    Session.set("isMobile", Meteor.Device.isTablet() || Meteor.Device.isPhone());

    var selected = Session.get("selected");
    if (!selected || !Parties.findOne(selected)) {
      var party = Parties.findOne();
      if (party)
        Session.set("selected", party._id);
      else
        Session.set("selected", null);
    }

    // Not sure best place to call this... calling it twice!
    getSuperuserId();
  });
});

///////////////////////////////////////////////////////////////////////////////
// Farm details sidebar

Template.details.helpers({
  party: function () {
    return Parties.findOne(Session.get("selected"));
  },
  anyParties: function () {
    return Parties.find().count() > 0;
  },
  creatorName: function () {
    var owner = Meteor.users.findOne(this.owner);
    if (owner._id === Meteor.userId())
      return "me";
    return displayName(owner);
  },
  isSuperuser: function() {
    var userId = Meteor.userId();
    return userId === getSuperuserId();
  },
  canRemove: function () {
    var userId = Meteor.userId();
    return this.owner === userId || userId === getSuperuserId(); // && attending(this) === 0;
  },
  maybeChosen: function (what) {
    var myRsvp = _.find(this.rsvps, function (r) {
      return r.user === Meteor.userId();
    }) || {};

    return what == myRsvp.rsvp ? "chosen btn-inverse" : "";
  }
});

Template.details.events({
  'click .rsvp_yes': function () {
    Meteor.call("rsvp", Session.get("selected"), "yes");
    return false;
  },
  'click .rsvp_maybe': function () {
    Meteor.call("rsvp", Session.get("selected"), "maybe");
    return false;
  },
  'click .rsvp_no': function () {
    Meteor.call("rsvp", Session.get("selected"), "no");
    return false;
  },
  'click .invite': function () {
    openInviteDialog();
    return false;
  },
  'click .remove': function () {
    Parties.remove(this._id);
    return false;
  }
});

///////////////////////////////////////////////////////////////////////////////
// Farm attendance widget

Template.attendance.helpers({
  rsvpName: function () {
    var user = Meteor.users.findOne(this.user);
    return displayName(user);
  },

  outstandingInvitations: function () {
    var party = Parties.findOne(this._id);
    return Meteor.users.find({$and: [
      {_id: {$in: party.invited}}, // they're invited
      {_id: {$nin: _.pluck(party.rsvps, 'user')}} // but haven't RSVP'd
    ]});
  },

  invitationName: function () {
    return displayName(this);
  },

  rsvpIs: function (what) {
    return this.rsvp === what;
  },

  nobody: function () {
    return !this.public && (this.rsvps.length + this.invited.length === 0);
  },

  canInvite: function () {
    return !this.public && (this.owner === Meteor.userId() || getSuperuserId() === Meteor.userId());
  },

  isSuperuser: function () {
    var userId = Meteor.userId();
    return userId === getSuperuserId();
  }
});

///////////////////////////////////////////////////////////////////////////////
// Map display

// Use jquery to get the position clicked relative to the map element.
var coordsRelativeToElement = function (element, event) {
  var offset = $(element).offset();
  var x = event.pageX - offset.left;
  var y = event.pageY - offset.top;
  return { x: x, y: y };
};

var distance2d = function (coords1, coords2) {
  var dx = coords2.x - coords1.x;
  var dy = coords2.y - coords1.y;
  var d = Math.sqrt(dx * dx + dy * dy);
  return d;
};

Template.map.events({
  'mousedown circle, mousedown text, tapcircle, tap text': function (event, template) {
    Session.set("selected", event.currentTarget.id);
  },
  'mousedown .map': function (event, template) {
    if (!Meteor.userId()) // must be logged in to create events
      return;
    var coords = coordsRelativeToElement(event.currentTarget, event);
    var pendingMapDoubleClick = Session.get('pending.map.doubleclick');
    if (pendingMapDoubleClick) {
      // clear pending map double click from session
      Session.set('pending.map.doubleclick', undefined);
      // distance method to allow some tolerance here:
      if (distance2d(pendingMapDoubleClick, coords) < 64) {
        // We have a second click at the same or nearby coords.
        openCreateDialog(coords.x / sizeX, coords.y / sizeY);    
      }
    } else {
      // set pending map double click in session and a timeout too:
      Session.set('pending.map.doubleclick', coords);
      Meteor.setTimeout(function() { Session.set('pending.map.doubleclick', undefined); }, 2000); // 2000ms timeout for SLOW double-press
    }
  },
  'dblclick .map': function (event, template) {
    if (!Meteor.userId()) // must be logged in to create events
      return;

    // clear pending map double click from session
    Session.set('pending.map.doubleclick', undefined);
    
    var coords = coordsRelativeToElement(event.currentTarget, event);
    openCreateDialog(coords.x / sizeX, coords.y / sizeY);
  }
});

Template.map.rendered = function () {
  var self = this;
  self.node = self.find("svg");

  if (!self.handle) {
    self.handle = Deps.autorun(function () {
      var selected = Session.get('selected');
      var selectedParty = selected && Parties.findOne(selected);
      var radius = function (party) {
        return 10 + Math.sqrt(attending(party)) * 10;
      };

      // Draw a circle for each party
      var updateCircles = function (group) {
        group.attr("id", function (party) { return party._id; })
        .attr("cx", function (party) { return party.x * sizeX; })
        .attr("cy", function (party) { return party.y * sizeY; })
        .attr("r", radius)
        .attr("class", function (party) {
          return party.public ? "public" : "private";
        })
        .style('opacity', function (party) {
          return selected === party._id ? 1 : 0.75;
        });
      };

      var circles = d3.select(self.node).select(".circles").selectAll("circle")
        .data(Parties.find().fetch(), function (party) { return party._id; });

      updateCircles(circles.enter().append("circle"));
      updateCircles(circles.transition().duration(250).ease("cubic-out"));
      circles.exit().transition().duration(250).attr("r", 0).remove();

      // Label each with the current attendance count
      var updateLabels = function (group) {
        group.attr("id", function (party) { return party._id; })
        .text(function (party) {return attending(party) || '';})
        .attr("x", function (party) { return party.x * sizeX; })
        .attr("y", function (party) { return party.y * sizeY + radius(party)/2 })
        .style('font-size', function (party) {
          return radius(party) * 1.25 + "px";
        });
      };

      var labels = d3.select(self.node).select(".labels").selectAll("text")
        .data(Parties.find().fetch(), function (party) { return party._id; });

      updateLabels(labels.enter().append("text"));
      updateLabels(labels.transition().duration(250).ease("cubic-out"));
      labels.exit().remove();

      // Draw a dashed circle around the currently selected party, if any
      var callout = d3.select(self.node).select("circle.callout")
        .transition().duration(250).ease("cubic-out");
      if (selectedParty)
        callout.attr("cx", selectedParty.x * sizeX)
        .attr("cy", selectedParty.y * sizeY)
        .attr("r", radius(selectedParty) + 10)
        .attr("class", "callout")
        .attr("display", '');
      else
        callout.attr("display", 'none');
    });
  }
};

Template.map.destroyed = function () {
  this.handle && this.handle.stop();
};

///////////////////////////////////////////////////////////////////////////////
// Create Party dialog

var openCreateDialog = function (x, y) {
  Session.set("createCoords", {x: x, y: y});
  Session.set("createError", null);
  Session.set("showCreateDialog", true);
};

Template.page.helpers({
  showCreateDialog: function () {
    return Session.get("showCreateDialog");
  }
});

Template.datetimepicker.rendered = function() {
  // initialize datetimepicker #datetimepicker .datetimepicker
  // format: 'DD/MM/YYYY HHmm'
  $('#datetimepicker').datetimepicker({locale: 'en-au', format: 'DD/MM/YYYY HHmm'});
};

Template.createDialog.events({
  'click .save': function (event, template) {
    var title = template.find(".title").value;
    var startdatetime = template.find(".startdatetime").value;
    var description = template.find(".description").value;
    var public = !template.find(".private").checked;
    var coords = Session.get("createCoords");

    if (title.length && description.length) {
      var id = createParty({
        title: title,
        startdatetime: startdatetime,
        description: description,
        x: coords.x,
        y: coords.y,
        public: public
      });

      Session.set("selected", id);
      if (!public && Meteor.users.find().count() > 1)
        openInviteDialog();
      Session.set("showCreateDialog", false);
    } else {
      Session.set("createError",
                  "It needs a title and a description, or why bother?");
    }
  },

  'click .cancel': function () {
    Session.set("showCreateDialog", false);
  }
});

Template.createDialog.helpers({
  error: function () {
    return Session.get("createError");
  }
});

///////////////////////////////////////////////////////////////////////////////
// Invite dialog

var openInviteDialog = function () {
  Session.set("showInviteDialog", true);
};

Template.page.helpers({
  showInviteDialog: function () {
    return Session.get("showInviteDialog");
  }
});

Template.inviteDialog.events({
  'click .invite': function (event, template) {
    Meteor.call('invite', Session.get("selected"), this._id);
  },
  'click .done': function (event, template) {
    Session.set("showInviteDialog", false);
    return false;
  }
});

Template.inviteDialog.helpers({
  uninvited: function () {
    var party = Parties.findOne(Session.get("selected"));
    if (!party)
      return []; // party hasn't loaded yet
    return Meteor.users.find({$nor: [{_id: {$in: party.invited}},
                                     {_id: party.owner}]});
  },

  displayName: function () {
    return displayName(this);
  }
});
