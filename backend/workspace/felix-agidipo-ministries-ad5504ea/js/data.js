/* ==========================================================================
   js/data.js
   Rev. Felix Agidipo Ministries — Seed Content + localStorage Data Store
   Acts as the "database" for the whole site. Every page (public + admin)
   reads/writes through this single API so content changes propagate as a
   simulated real-time publishing pipeline.
   ========================================================================== */

(function (window) {
  "use strict";

  var PREFIX = "rfam_"; // Rev Felix Agidipo Ministries
  var EVENT_NAME = "ministrydata:change";

  var KEYS = {
    activities: PREFIX + "activities",
    events: PREFIX + "events",
    sermons: PREFIX + "sermons",
    gallery: PREFIX + "gallery",
    news: PREFIX + "news",
    messages: PREFIX + "messages",
    settings: PREFIX + "settings",
    seeded: PREFIX + "seeded_v1"
  };

  /* ---------------------------- low-level I/O ---------------------------- */

  function safeParse(raw, fallback) {
    try { return raw ? JSON.parse(raw) : fallback; }
    catch (e) { return fallback; }
  }

  function read(key, fallback) {
    try { return safeParse(window.localStorage.getItem(key), fallback); }
    catch (e) { return fallback; }
  }

  function write(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { key: key } }));
      return true;
    } catch (e) { return false; }
  }

  function uid(prefix) {
    return (prefix || "id") + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function nowISO() { return new Date().toISOString(); }

  /* ------------------------------- seed data ------------------------------ */

  var seedActivities = [
    { title: "Dawn Watch Prayer Hour", category: "Prayer", schedule: "Mon – Fri, 5:30 AM", location: "Sanctuary & Live Stream", description: "A daybreak gathering of intercession where the household of faith stands in the gap before the city wakes — rooted in the conviction that light breaks first in the secret place." },
    { title: "Radiant Foundations Discipleship", category: "Discipleship", schedule: "Tuesdays, 6:00 PM", location: "Fellowship Hall B", description: "A twelve-week pathway for new believers moving from decision to formation, built around Scripture memory, mentorship pairs, and guided testimony writing." },
    { title: "Gospel Light Outreach Corps", category: "Outreach", schedule: "3rd Saturday, monthly", location: "Various Communities", description: "Teams carrying food relief, clothing, and the plain preaching of the Gospel into underserved neighborhoods surrounding the ministry's home base." },
    { title: "Sunrise Youth Encounter", category: "Youth", schedule: "Fridays, 5:00 PM", location: "Youth Annex", description: "Worship, mentorship, and unfiltered conversation for teens and young adults navigating faith, identity, and calling in a noisy generation." },
    { title: "Chorale of the Dawn", category: "Music", schedule: "Wednesdays, 7:00 PM", location: "Music Room", description: "The ministry's choir and instrumentalists rehearsing anthems and Yoruba-English praise medleys for Sunday worship and revival crusades." },
    { title: "Widows & Elders Care Circle", category: "Outreach", schedule: "2nd Sunday, monthly", location: "Fellowship Hall A", description: "A dedicated visitation and provision ministry honoring the elderly and widowed within the congregation with practical support and companionship." },
    { title: "Marketplace Believers Forum", category: "Discipleship", schedule: "1st Saturday, monthly", location: "Conference Room", description: "A gathering for professionals and business owners exploring faith-integrated ethics, integrity in commerce, and Kingdom stewardship of influence." }
  ].map(function (a) {
    return Object.assign({ id: uid("act"), status: "published", image: "beam-" + (1 + Math.floor(Math.random() * 4)), createdAt: nowISO() }, a);
  });

  var seedEvents = [
    { title: "Break of Day Revival Crusade", category: "Revival", date: "2025-03-14", time: "5:00 AM – 8:00 AM", location: "Freedom Grounds, Ibadan Road", description: "A three-day open-air crusade under the theme 'Light After Midnight' — extended altar calls, deliverance ministration, and citywide invitation.", featured: true },
    { title: "Annual Gospel Light Conference", category: "Conference", date: "2025-04-25", time: "9:00 AM – 4:00 PM", location: "Main Sanctuary", description: "Teaching sessions on prophetic living and Kingdom leadership with guest ministers, culminating in a Saturday night impartation service.", featured: true },
    { title: "Good Friday Watch-Night Service", category: "Special Service", date: "2025-04-18", time: "10:00 PM – 1:00 AM", location: "Main Sanctuary", description: "A solemn night of the Lord's Supper, reflection on the Cross, and sunrise-themed worship anticipating Resurrection Sunday.", featured: false },
    { title: "Youth Encounter Camp: Unashamed", category: "Youth", date: "2025-07-10", time: "3-Day Retreat", location: "Palm Grove Retreat Center", description: "A residential camp for teens and young adults centered on identity, purity, and calling — worship nights, workshops, and bonfire testimonies.", featured: true },
    { title: "Community Health & Food Outreach", category: "Outreach", date: "2025-05-17", time: "8:00 AM – 2:00 PM", location: "Ogunlana Community Square", description: "Free medical screening, food distribution, and personal evangelism carried out with partner clinics and volunteer teams.", featured: false },
    { title: "Harvest Thanksgiving Sunday", category: "Special Service", date: "2025-11-09", time: "8:00 AM & 10:30 AM", location: "Main Sanctuary", description: "A double-service celebration of God's provision through the year, with cultural praise, giving, and a shared fellowship meal.", featured: false },
    { title: "Ministers & Workers Retreat", category: "Conference", date: "2025-09-05", time: "2-Day Retreat", location: "Mountview Lodge", description: "A sabbath of renewal for pastors, department heads, and volunteer workers — teaching, rest, and realignment before the final quarter.", featured: false }
  ].map(function (e) {
    return Object.assign({ id: uid("evt"), status: "published", image: "beam-" + (1 + Math.floor(Math.random() * 4)), createdAt: nowISO() }, e);
  });

  var seedSermons = [
    { title: "Light After Midnight", series: "Radiant Faith", scripture: "Psalm 30:5", date: "2025-01-05", videoUrl: "#", audioUrl: "#", description: "On the certainty of joy arriving with the morning, even when the night of waiting feels unbroken.", tags: ["hope", "perseverance"] },
    { title: "The Sunrise Visitation", series: "Radiant Faith", scripture: "Luke 1:78-79", date: "2025-01-12", videoUrl: "#", audioUrl: "#", description: "Examining the 'dayspring from on high' as a personal, present visitation and not a distant memory of Bethlehem.", tags: ["Christ", "hope"] },
    { title: "Clouds Without Rain", series: "Discernment", scripture: "Jude 1:12", date: "2025-01-19", videoUrl: "#", audioUrl: "#", description: "A sober word on false promise and hollow profession, and the call to bear real, weighty fruit.", tags: ["discernment", "fruitfulness"] },
    { title: "Walking in the Light", series: "Foundations", scripture: "1 John 1:7", date: "2025-01-26", videoUrl: "#", audioUrl: "#", description: "Fellowship, confession, and cleansing as the ordinary rhythm of a life lived in the open before God.", tags: ["holiness", "fellowship"] },
    { title: "A Lamp Unto My Feet", series: "Foundations", scripture: "Psalm 119:105", date: "2025-02-02", videoUrl: "#", audioUrl: "#", description: "Why Scripture is given as a lamp for the next step, not a floodlight for the whole road.", tags: ["scripture", "guidance"] },
    { title: "The Glory That Follows", series: "Radiant Faith", scripture: "Isaiah 60:1-2", date: "2025-02-09", videoUrl: "#", audioUrl: "#", description: "Arising and shining as a corporate mandate for the Church in a season of gathering darkness.", tags: ["revival", "glory"] },
    { title: "Sons of the Morning", series: "Identity", scripture: "Romans 8:19", date: "2025-02-16", videoUrl: "#", audioUrl: "#", description: "Creation's groaning and the revealing of the sons of God — a message on identity and expectation.", tags: ["identity", "sonship"] },
    { title: "Until the Day Breaks", series: "Discernment", scripture: "Song of Solomon 2:17", date: "2025-02-23", videoUrl: "#", audioUrl: "#", description: "Patient devotion in seasons of delay, and the intimacy that waits with open eyes for the shadows to flee.", tags: ["devotion", "patience"] }
  ].map(function (s) {
    return Object.assign({ id: uid("srm"), status: "published", speaker: "Rev. Felix Agidipo", image: "beam-" + (1 + Math.floor(Math.random() * 4)), createdAt: nowISO() }, s);
  });

  var seedGallery = [
    { title: "Dawn Watch, First Sunday", category: "Worship", date: "2025-01-05", caption: "Intercessors gathered before sunrise for the first Dawn Watch of the year." },
    { title: "Freedom Grounds Crusade", category: "Crusade", date: "2024-11-16", caption: "Overflow crowds at the closing night of the citywide revival crusade." },
    { title: "Sunrise Youth Camp", category: "Youth", date: "2024-07-13", caption: "Campers in worship around the bonfire on the final night of retreat." },
    { title: "Community Food Distribution", category: "Outreach", date: "2024-05-18", caption: "Volunteers distributing relief packages in Ogunlana Community Square." },
    { title: "Chorale Rehearsal", category: "Music", date: "2024-09-04", caption: "The Chorale of the Dawn preparing anthems for the Harvest service." },
    { title: "Baptism Sunday", category: "Worship", date: "2024-08-11", caption: "New believers testifying before their water baptism." },
    { title: "Widows Care Visitation", category: "Outreach", date: "2024-06-09", caption: "The Elders Care Circle sharing a meal with congregation elders." },
    { title: "Ministers Retreat Fellowship", category: "Fellowship", date: "2024-09-06", caption: "Workers and department heads at the Mountview Lodge retreat." }
  ].map(function (g) {
    return Object.assign({ id: uid("gal"), status: "published", image: "beam-" + (1 + Math.floor(Math.random() * 4)), createdAt: nowISO() }, g);
  });

  var seedNews = [
    { title: "Ministry Announces 2025 Theme: 'Light After Midnight'", category: "Announcement", date: "2025-01-02", author: "Ministry Press Desk", excerpt: "Rev. Felix Agidipo unveils the ministry's guiding theme for the year, calling the congregation to steadfast hope in seasons of delay.", body: "At the New Year Watch Service, Rev. Felix Agidipo formally introduced 'Light After Midnight' as the ministry's theme for 2025, drawing from Psalm 30:5. The theme will shape preaching series, the annual conference, and outreach messaging through the year, with an emphasis on hope that arrives precisely when a season feels darkest." },
    { title: "Freedom Grounds Crusade Records Record Attendance", category: "Report", date: "2024-11-18", author: "Ministry Press Desk", excerpt: "The three-day open-air crusade closed with its largest single-night crowd in the ministry's history and dozens of recorded testimonies.", body: "The closing night of the Break of Day Revival Crusade drew an estimated crowd surpassing previous years, with an extended altar call and a reported surge of first-time commitments. Follow-up teams have since been dispatched to connect new converts with local discipleship groups." },
    { title: "New Discipleship Track Launches for First-Time Believers", category: "Ministry Update", date: "2024-10-06", author: "Discipleship Department", excerpt: "'Radiant Foundations' begins its first twelve-week cohort this month, pairing new believers with trained mentors.", body: "The Discipleship Department has launched Radiant Foundations, a structured twelve-week track combining Scripture memorization, mentorship pairing, and guided testimony writing. The pilot cohort includes over forty new believers from recent crusades and Sunday services." },
    { title: "Community Health Outreach Serves Over 600 Residents", category: "Outreach", date: "2024-05-19", author: "Outreach Team", excerpt: "Partner clinics joined the ministry's food and medical outreach at Ogunlana Community Square over the weekend.", body: "In partnership with two community clinics, the Gospel Light Outreach Corps provided free health screenings, basic medication, and food packages to over six hundred residents. Volunteers also conducted personal evangelism conversations throughout the event." },
    { title: "Rev. Agidipo to Address Ministers & Workers Retreat", category: "Announcement", date: "2025-08-20", author: "Ministry Press Desk", excerpt: "This year's retreat theme, 'Realignment Before the Harvest,' will focus on sustaining ministry workers through seasons of demand.", body: "Ahead of the September Ministers & Workers Retreat, Rev. Felix Agidipo shared that this year's sessions will center on rest, realignment, and renewal for pastors and volunteer leaders heading into the final quarter of the ministry calendar." }
  ].map(function (n) {
    return Object.assign({ id: uid("nws"), status: "published", image: "beam-" + (1 + Math.floor(Math.random() * 4)), createdAt: nowISO() }, n);
  });

  var seedSettings = {
    siteName: "Rev. Felix Agidipo Ministries",
    shortName: "RFAM",
    tagline: "Where the Gospel Breaks Through",
    verse: "Weeping may endure for a night, but joy cometh in the morning.",
    verseRef: "Psalm 30:5",
    heroHeadline: "The Light Still Breaks Through",
    heroSub: "A ministry raised to carry the Gospel of Jesus Christ into the darkest hours — through preaching, discipleship, and relentless outreach.",
    aboutShort: "For over two decades, Rev. Felix Agidipo has led a growing family of believers committed to prayer, sound teaching, and hands-on compassion.",
    aboutFull: "Rev. Felix Agidipo Ministries began as a small dawn prayer gathering of seven believers in 2001 and has since grown into a congregation and outreach network spanning multiple communities. Rev. Agidipo's conviction, drawn from Psalm 30:5, is that the darkest hour of any trial is precisely where God's light is most dramatically revealed. That conviction shapes every department of the ministry — from the Dawn Watch intercessors who gather before sunrise, to the Outreach Corps who carry practical relief into underserved neighborhoods, to the Youth Encounter that disciples the next generation. The ministry holds no illusions about the darkness in view, but preaches, without apology, that it does not get the final word.",
    missionStatement: "To preach Christ plainly, disciple believers deeply, and carry practical compassion into every community within reach.",
    visionStatement: "A generation that recognizes the dawn — spiritually alert, biblically grounded, and unashamed of the Gospel.",
    foundedYear: "2001",
    address: "14 Radiance Close, Off Ibadan Road, Lagos, Nigeria",
    phone: "+234 803 555 0142",
    email: "info@felixagidipoministries.org",
    serviceTimes: [
      { day: "Sunday", label: "First Service", time: "8:00 AM" },
      { day: "Sunday", label: "Second Service", time: "10:30 AM" },
      { day: "Wednesday", label: "Bible Study", time: "6:00 PM" },
      { day: "Mon – Fri", label: "Dawn Watch Prayer", time: "5:30 AM" }
    ],
    social: {
      facebook: "https://facebook.com/felixagidipoministries",
      youtube: "https://youtube.com/@felixagidipoministries",
      instagram: "https://instagram.com/felixagidipoministries",
      twitter: "https://twitter.com/revfelixagidipo"
    }
  };

  /* ------------------------------- seeding -------------------------------- */

  function seedIfEmpty() {
    if (read(KEYS.seeded, false)) return;
    write(KEYS.activities, seedActivities);
    write(KEYS.events, seedEvents);
    write(KEYS.sermons, seedSermons);
    write(KEYS.gallery, seedGallery);
    write(KEYS.news, seedNews);
    write(KEYS.messages, []);
    write(KEYS.settings, seedSettings);
    try { window.localStorage.setItem(KEYS.seeded, JSON.stringify(true)); } catch (e) {}
  }

  /* ------------------------------ collection API --------------------------- */

  function makeCollectionAPI(key, defaults) {
    return {
      getAll: function () { return read(key, defaults); },
      getPublished: function () {
        return read(key, defaults).filter(function (item) { return item.status === "published"; });
      },
      getById: function (id) {
        return read(key, defaults).filter(function (item) { return item.id === id; })[0] || null;
      },
      add: function (item) {
        var list = read(key, defaults);
        var record = Object.assign({
          id: uid(key.slice(0, 3)),
          status: "published",
          createdAt: nowISO()
        }, item);
        list.unshift(record);
        write(key, list);
        return record;
      },
      update: function (id, patch) {
        var list = read(key, defaults);
        var idx = -1;
        for (var i = 0; i < list.length; i++) { if (list[i].id === id) { idx = i; break; } }
        if (idx === -1) return null;
        list[idx] = Object.assign({}, list[idx], patch, { updatedAt: nowISO() });
        write(key, list);
        return list[idx];
      },
      remove: function (id) {
        var list = read(key, defaults).filter(function (item) { return item.id !== id; });
        write(key, list);
        return true;
      },
      setAll: function (list) { write(key, list); return list; },
      count: function () { return read(key, defaults).length; }
    };
  }

  /* --------------------------------- utils --------------------------------- */

  var MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

  function formatDate(iso, opts) {
    if (!iso) return "";
    var parts = iso.split("-");
    if (parts.length < 3) return iso;
    var y = parseInt(parts[0], 10), m = parseInt(parts[1], 10) - 1, d = parseInt(parts[2], 10);
    var date = new Date(y, m, d);
    if (isNaN(date.getTime())) return iso;
    if (opts && opts.short) return MONTHS[m].slice(0, 3) + " " + d + ", " + y;
    return MONTHS[m] + " " + d + ", " + y;
  }

  function formatDay(iso) {
    if (!iso) return "";
    var parts = iso.split("-");
    return parts.length >= 3 ? parseInt(parts[2], 10) : "";
  }

  function formatMonthShort(iso) {
    if (!iso) return "";
    var parts = iso.split("-");
    return parts.length >= 3 ? MONTHS[parseInt(parts[1], 10) - 1].slice(0, 3).toUpperCase() : "";
  }

  function isUpcoming(iso) {
    if (!iso) return false;
    var d = new Date(iso + "T23:59:59");
    return d.getTime() >= new Date().setHours(0, 0, 0, 0);
  }

  /* -------------------------------- messages -------------------------------- */

  var messagesAPI = makeCollectionAPI(KEYS.messages, []);
  var originalMessageAdd = messagesAPI.add;
  messagesAPI.add = function (item) {
    return originalMessageAdd(Object.assign({ read: false, date: nowISO() }, item));
  };

  /* -------------------------------- settings -------------------------------- */

  var settingsAPI = {
    get: function () { return read(KEYS.settings, seedSettings); },
    update: function (patch) {
      var current = read(KEYS.settings, seedSettings);
      var next = Object.assign({}, current, patch);
      write(KEYS.settings, next);
      return next;
    }
  };

  /* --------------------------------- reset ---------------------------------- */

  function resetAll() {
    try {
      window.localStorage.removeItem(KEYS.seeded);
      [KEYS.activities, KEYS.events, KEYS.sermons, KEYS.gallery, KEYS.news, KEYS.messages, KEYS.settings]
        .forEach(function (k) { window.localStorage.removeItem(k); });
    } catch (e) {}
    seedIfEmpty();
  }

  /* --------------------------------- expose ---------------------------------- */

  seedIfEmpty();

  window.MinistryDB = {
    KEYS: KEYS,
    EVENT_NAME: EVENT_NAME,
    activities: makeCollectionAPI(KEYS.activities, seedActivities),
    events: makeCollectionAPI(KEYS.events, seedEvents),
    sermons: makeCollectionAPI(KEYS.sermons, seedSermons),
    gallery: makeCollectionAPI(KEYS.gallery, seedGallery),
    news: makeCollectionAPI(KEYS.news, seedNews),
    messages: messagesAPI,
    settings: settingsAPI,
    utils: {
      uid: uid,
      formatDate: formatDate,
      formatDay: formatDay,
      formatMonthShort: formatMonthShort,
      isUpcoming: isUpcoming
    },
    resetAll: resetAll,
    onChange: function (callback) {
      window.addEventListener(EVENT_NAME, callback);
      window.addEventListener("storage", callback);
    }
  };

})(window);