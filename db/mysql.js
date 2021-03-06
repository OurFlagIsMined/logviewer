var mysql = require('mysql');
var winston = require('winston');

module.exports = function MySQLDatabaseConnector(settings) {
	var self = this;
	self.pool = mysql.createPool({
		connectionLimit: 100,
		host: settings.host,
		port: settings.port || 3306,
		user: settings.user,
		database: settings.database,
		password: settings.password,
		charset: "utf8mb4_unicode_ci"
	});
	self.pool.getConnection(function(err, connection) {
		if(err) {
			winston.error('Error connecting to MySQL database: ' + err.stack);
			return;
		}
		// create the channels table if it doesnt exist
		connection.query("CREATE TABLE IF NOT EXISTS channels ("
			+"id int(10) unsigned,"
			+"name varchar(32) PRIMARY KEY,"
			+"active tinyint(4) unsigned NOT NULL DEFAULT '0',"
			+"modlogs tinyint(4) unsigned NOT NULL DEFAULT '0',"
			+"viewlogs tinyint(4) unsigned NOT NULL DEFAULT '0',"
			+"viewmodlogs tinyint(4) unsigned NOT NULL DEFAULT '5',"
			+"viewcomments tinyint(4) unsigned NOT NULL DEFAULT '5',"
			+"writecomments tinyint(4) unsigned NOT NULL DEFAULT '5',"
			+"deletecomments tinyint(4) unsigned NOT NULL DEFAULT '10',"
			+"`max-age` int(10) unsigned NOT NULL DEFAULT '2678400'"
		+")");
		// create the auth table if it doesnt exist
		connection.query("CREATE TABLE IF NOT EXISTS auth ("
			+"token varchar(64) PRIMARY KEY,"
			+"name varchar(32),"
			+"expires BIGINT unsigned"
		+")");
		// create the comment table if it doesnt exist
		connection.query("CREATE TABLE IF NOT EXISTS comments ("
			+"id INT NOT NULL AUTO_INCREMENT,"
			+"added BIGINT UNSIGNED NOT NULL,"
			+"edited BIGINT UNSIGNED NOT NULL,"
			+"channel VARCHAR(32) NULL,"
			+"author VARCHAR(32) NULL,"
			+"topic VARCHAR(64) NULL,"
			+"text TEXT NULL COLLATE utf8mb4_unicode_ci,"
			+"PRIMARY KEY (id),"
			+"INDEX comments_by_channel_and_topic (channel ASC, topic ASC)"
		+")");
		// create the alias table if it doesnt exist
		connection.query("CREATE TABLE IF NOT EXISTS aliases ("
			+"alias varchar(32) PRIMARY KEY,"
			+"name varchar(32)"
		+")");
		
		// create the logviewer tables if they dont exist
		self.ensureTablesExist({name: "logviewer"});
		
		/* create the integrations table if it doesnt exist */
		connection.query("CREATE TABLE IF NOT EXISTS connections ("
			+"id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
			+"channel VARCHAR(32) NULL,"
			+"level INT DEFAULT '0'," // access level of the connection
			+"app VARCHAR(32) NOT NULL PRIMARY KEY," // name of the app (for example "Slack")
			// identifier of the application (used to identify the location the request came from) 
			// essentially the user name (for example, a Slack connection uses the slash command token to identify )
			+"data VARCHAR(256) NULL," 
			+"description TEXT NULL" // Full-text description
		+")");
		
		/* create the integrations table if it doesnt exist */
		connection.query("CREATE TABLE IF NOT EXISTS apps ("
			+"id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
			+"scopes VARCHAR(64) NULL," // optimal scopes this app needs
			+"name VARCHAR(32) NOT NULL PRIMARY KEY," // name of the app (for example "Slack")
			+"redirect_url VARCHAR(256) NULL," // url to redirect to after authenticating
			+"description TEXT NULL" // Full-text description
		+")");
		
		/* create the admin log table if it doesnt exist */
		connection.query("CREATE TABLE IF NOT EXISTS adminlog ("
			+"id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
			+"time BIGINT UNSIGNED NOT NULL,"
			+"channel VARCHAR(32) NULL,"
			+"user VARCHAR(32) NULL,"
			+"action VARCHAR(32) NULL,"
			+"name VARCHAR(256) NULL,"
			+"data TEXT NULL,"
			+"INDEX adminlog_channel (channel ASC)"
		+")");

	});
	
	self.ensureTablesExist = function(channelObj) {
		self.pool.query("CREATE TABLE IF NOT EXISTS chat_"+channelObj.name+" ("
			+"id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
			+"time BIGINT UNSIGNED NOT NULL,"
			+"nick VARCHAR(32) NOT NULL,"
			+"text VARCHAR(2047) COLLATE utf8mb4_unicode_ci NOT NULL,"
			+"modlog VARCHAR(1024) DEFAULT NULL,"
			+"INDEX (nick, time),"
			+"INDEX (time)"
		+")");
		self.pool.query("CREATE TABLE IF NOT EXISTS users_"+channelObj.name+" ("
			+"nick VARCHAR(32) NOT NULL PRIMARY KEY,"
			+"messages INT UNSIGNED DEFAULT '0',"
			+"timeouts INT UNSIGNED DEFAULT '0',"
			+"level INT DEFAULT '0',"
			+"INDEX (messages DESC)"
		+")");
	}
	
	self.getChannels = function(callback) {
		self.pool.query("SELECT * FROM channels WHERE active=1",function(error, results, fields){
			callback(results);
		});
	}
	
	self.getChannelList = function(callback) {
		self.pool.query("SELECT name, id FROM channels WHERE active=1",function(error, results, fields){
			callback(results);
		});
	}
	
	self.getAliases = function(callback) {
		self.pool.query("SELECT name, alias FROM aliases",function(error, results, fields){
			callback(results);
		});
	}
	
	self.getActiveChannel = function(channel, callback) {
		self.pool.query("SELECT * FROM channels WHERE name=? AND active=1",[channel],function(error, results, fields){
			if(results.length == 0) {
				self.pool.query("SELECT name FROM aliases WHERE alias=?",[channel],function(error, results, fields){
					if(results.length == 0) {
						callback(null);
					} else {
						self.getActiveChannel(results[0].name, callback);
					}
				});
			}
			else callback(results[0]);
		});
	}
	
	self.getChannel = function(channel, callback) {
		self.pool.query("SELECT * FROM channels WHERE name=?",[channel],function(error, results, fields){
			if(results.length == 0) {
				self.pool.query("SELECT name FROM aliases WHERE alias=?",[channel],function(error, results, fields){
					if(results.length == 0) {
						callback(null);
					} else {
						self.getChannel(results[0].name, callback);
					}
				});
			}
			else callback(results[0]);
		});
	}
	
	self.addChannel = function(channelObj, callback) {
		self.ensureTablesExist(channelObj);
		self.pool.query("INSERT INTO channels (name, id) VALUES (?,?)",[channelObj.name, channelObj.id],function(error, result){
			if(error) {
				winston.error("Couldnt add channel! "+error);
			} else {
				self.pool.query("SELECT * FROM channels WHERE name=?",[channelObj.name], function(error, results, fields){
					if(error || results.length == 0) {
						winston.error("Channel wasnt added properly! "+(error || "No results returned..."));
					} else {
						callback(results[0]);
					}
				});
			}
		});
	}
	
	self.addLine = function(channel, nick, message, count, callback) {
		// we use the pool for this instead of the pool
		self.pool.query("INSERT INTO ?? (time,nick,text) VALUES (?,?,?)",["chat_"+channel, Math.floor(Date.now()/1000), nick, message], function(error, result) {
			if(error) {
				winston.error("addLine: Could not insert! "+error);
				return;
			}
			if(callback) callback(result.insertId);
		});
		if(count !== false) self.pool.query("INSERT INTO ?? (nick,messages) VALUES (?,1) ON DUPLICATE KEY UPDATE messages = messages + 1",["users_"+channel, nick,nick]);
	}
	
	self.addModLog = function(channel, nick, message, count, modlog, callback) {
		// we use the pool for this instead of the pool
		self.pool.query("INSERT INTO ?? (time,nick,text,modlog) VALUES (?,?,?,?)",["chat_"+channel, Math.floor(Date.now()/1000), nick, message, modlog?JSON.stringify(modlog):null], function(error, result) {
			if(error) {
				winston.error("addModLog: Could not insert! "+error);
				return;
			}
			if(callback) callback(result.insertId);
		});
		if(count === true) self.pool.query("INSERT INTO ?? (nick,messages) VALUES (?,1) ON DUPLICATE KEY UPDATE messages = messages + 1",["users_"+channel, nick,nick]);
	}
	
	self.addTimeout = function(channel, nick, time, message, modlog, count, callback) {
		self.pool.query("INSERT INTO ?? (time,nick,text,modlog) VALUES (?,?,?,?)",["chat_"+channel, Math.floor(time/1000), nick, message,JSON.stringify(modlog)], function(error, result){
			if(error) {
				winston.error("addTimeout: Could not insert! "+error);
				return;
			}
			if(callback)callback(result.insertId);
		});
		if(count) self.pool.query("INSERT INTO ?? (nick,timeouts) VALUES (?,1) ON DUPLICATE KEY UPDATE timeouts = timeouts + 1",["users_"+channel, nick, nick]);
	}
	
	self.updateTimeout = function(channel, nick, id, time, message, modlog) {
		// we use the pool for this instead of the pool
		self.pool.query("UPDATE ?? SET time=?, text=?, modlog=? WHERE nick=? AND id=?",["chat_"+channel, Math.floor(time/1000), message, JSON.stringify(modlog), nick, id]);
	}
	
	function parseModLogs(list){
		for(var i=0;i<list.length;++i) {
			let ml = list[i].modlog;
			if(ml) {
				if(ml === "0") list[i].modlog = null;
				else list[i].modlog = JSON.parse(ml);
			}
		}
	}
	
	self.getLogsByNick = function(channel, nick, limit, modlogs, callback) {
		self.pool.query("SELECT id,time,nick,text"+(modlogs?",modlog":"")+" FROM ?? WHERE nick=? ORDER BY time DESC LIMIT ?", ["chat_"+channel, nick, limit], function(error, results, fields) {
			if(error) {
				winston.error("getLogsByNick: Select failed! "+error);
				return;
			}
			parseModLogs(results);
			if(results) callback(results.reverse());
			else callback([]);
		});
	}
	
	self.getLogsById = function(channel, id, nick, before, after, modlogs, callback) {
		var beforeRes = null;
		var afterRes = null;
		// before
		if(before > 0) {
			if(nick) {
				self.pool.query("SELECT id,time,nick,text"+(modlogs?",modlog":"")+" FROM ?? WHERE nick=? AND id < ? ORDER BY id DESC LIMIT ?", ["chat_"+channel, nick, id, before], function(error, results, fields) {
					if(results) beforeRes = results.reverse();
					else beforeRes = [];
					parseModLogs(beforeRes);
					if(afterRes !== null) callback(beforeRes, afterRes);
				});
			} else {
				// we exclude twitchnotify when not checking a specific user
				self.pool.query("SELECT id,time,nick,text"+(modlogs?",modlog":"")+" FROM ?? WHERE id < ? ORDER BY id DESC LIMIT ?", ["chat_"+channel, id, before], function(error, results, fields) {
					if(results) beforeRes = results.reverse();
					else beforeRes = [];
					parseModLogs(beforeRes);
					if(afterRes !== null) callback(beforeRes, afterRes);
				});
			}
		} else { beforeRes = []; }
		// after
		if(after > 0) {
			if(nick) {
				self.pool.query("SELECT id,time,nick,text"+(modlogs?",modlog":"")+" FROM ?? WHERE nick=? AND id > ? ORDER BY id ASC LIMIT ?", ["chat_"+channel, nick, id, after], function(error, results, fields) {
					if(results) afterRes = results;
					else afterRes = [];
					parseModLogs(afterRes);
					if(beforeRes !== null) callback(beforeRes, afterRes);
				});
			} else {
				// we exclude twitchnotify when not checking a specific user
				self.pool.query("SELECT id,time,nick,text"+(modlogs?",modlog":"")+" FROM ?? WHERE id > ? ORDER BY id ASC LIMIT ?", ["chat_"+channel, id, after], function(error, results, fields) {
					if(results) afterRes = results;
					else afterRes = [];
					parseModLogs(afterRes);
					if(beforeRes !== null) callback(beforeRes, afterRes);
				});
			}
		} else { 
			afterRes = []; 
			if(beforeRes !== null) callback(beforeRes, afterRes); 
		}
	}
	
	self.getLogsByTime = function(channel, time, before, after, modlogs, callback) {
		var beforeRes = null;
		var afterRes = null;
		// before
		if(before > 0) {
			self.pool.query("SELECT id,time,nick,text"+(modlogs?",modlog":"")+" FROM ?? WHERE time < ? ORDER BY time DESC LIMIT ?", ["chat_"+channel, time, before], function(error, results, fields) {
				if(results) beforeRes = results.reverse();
				else beforeRes = [];
				parseModLogs(beforeRes);
				if(afterRes !== null) callback(beforeRes, afterRes);
			});
		} else { beforeRes = []; }
		// after
		if(after > 0) {
			// we exclude twitchnotify when not checking a specific user
			self.pool.query("SELECT id,time,nick,text"+(modlogs?",modlog":"")+" FROM ?? WHERE time >= ? ORDER BY time ASC LIMIT ?", ["chat_"+channel, time, after], function(error, results, fields) {
				if(results) afterRes = results;
				else afterRes = [];
				parseModLogs(afterRes);
				if(beforeRes !== null) callback(beforeRes, afterRes);
			});
		} else { 
			afterRes = []; 
			if(beforeRes !== null) callback(beforeRes, afterRes); 
		}
	}
	
	self.getUserStats = function(channel, nick, callback) {
		self.pool.query("SELECT nick, messages, timeouts FROM ?? WHERE nick = ?", ["users_"+channel, nick], function(error, results, fields) {
			callback(results[0] || {nick: nick, timeouts:0, messages: 0});
		});
	}
	
	self.getAuthUser = function(token, callback) {
		self.pool.query("SELECT name FROM auth WHERE token=? AND expires > ?",[token,Math.floor(Date.now()/1000)], function(error, results, fields) {
			if(results && results.length>0) callback(results[0].name);
			else callback(null);
		});
	}
	
	self.getUserLevel = function(channel, nick, callback) {
		self.pool.query("SELECT level FROM ?? WHERE nick = ?", ["users_"+channel, nick], function(error, results, fields) {
			if(results && results.length>0) callback(results[0].level || 0);
			else callback(0);
		});
	}
	
	self.setLevel = function(channel, nick, level) {
		self.pool.query("INSERT INTO ?? (nick,level) VALUES (?,?) ON DUPLICATE KEY UPDATE level = ?",["users_"+channel, nick, level, level, nick]);
	}
	
	self.getLevels = function(channel, callback) {
		self.pool.query("SELECT nick,level FROM ?? WHERE level != 0", ["users_"+channel], function(error, results, fields) {
			callback(results);
		});
	}
	
	self.storeToken = function(user, token, expires) {
		self.pool.query("INSERT INTO auth (name, token, expires) VALUES (?,?,?)",[user,token,expires]);
	}
	
	self.deleteToken = function(token) {
		self.pool.query("DELETE FROM auth WHERE token=?",[token]);
	}
	
	self.checkAndRefreshToken = function(user, token, expires, callback) {
		self.pool.query("UPDATE auth SET expires=? WHERE name=? AND token=? AND expires > ?",[expires,user,token,Math.floor(Date.now()/1000)], function(error, result) {
			if(callback) callback(result.affectedRows > 0);
		});
	}
	
	self.setSetting = function(channel, key, val) {
		self.pool.query("UPDATE channels SET ??=? WHERE name=?",[key,val,channel]);
	}
	
	self.getComments = function(channel,topic,callback) {
		self.pool.query("SELECT * FROM comments WHERE channel=? AND topic=?",[channel,topic],function(error,results,fields) {
			callback(results);
		});
	}
	
	self.getComment = function(channel,id,callback) {
		self.pool.query("SELECT * FROM comments WHERE id=? AND channel=?",[id,channel],function(error,results,fields) {
			callback(results[0]);
		});
	}
	
	self.addComment = function(channel, author, topic, text, callback) {
		var d = Math.floor(Date.now()/1000);
		self.pool.query("INSERT INTO comments(added,edited,channel,author,topic,text) VALUES (?,?,?,?,?,?)", [d,d,channel,author,topic,text], function(error, result) {
			if(callback) callback(result.insertId);
		});
	}
	
	self.updateComment = function(channel,id,newtext) {
		self.pool.query("UPDATE comments SET text=?, edited=? WHERE id=? AND channel=?",[newtext,Math.floor(Date.now()/1000),id,channel]);
	}
	
	self.deleteComment = function(channel,id) {
		self.pool.query("DELETE FROM comments WHERE id=? AND channel=?",[id,channel]);
	}
	
	self.findUser = function(channel, query, callback) {
		var searchString = query.replace("_","\\_").replace("*","%")+"%";
		searchString = searchString.replace(/%{2,}/g,"%");
		self.pool.query("SELECT nick FROM ?? WHERE nick LIKE ? LIMIT 11",["users_"+channel, searchString], function(error,results,fields) {
			callback(results);
		});
	}
	
	/* "CREATE TABLE IF NOT EXISTS adminlog ("
			+"time BIGINT UNSIGNED NOT NULL,"
			+"channel VARCHAR(32) NULL,"
			+"user VARCHAR(32) NULL,"
			+"action VARCHAR(32) NULL," -> setting/level/(dis)connect/(add/edit/remove) comment
			+"key VARCHAR(32) NULL," -> setting/user/connection name/comment id
			+"data VARCHAR(256) NULL" -> new value/level/key/comment text
		+")" */
	self.adminLog = function(channel, user, action, key, data) {
		var d = Math.floor(Date.now()/1000);
		self.pool.query("INSERT INTO adminlog(time,channel,user,action,name,data) VALUES (?,?,?,?,?,?)", [d,channel,user,action,key,data]);
	}
	
	self.getEvents = function(channel, limit, callback) {
		self.pool.query("SELECT * FROM (SELECT * FROM adminlog WHERE channel=? ORDER BY id DESC LIMIT ?) sub ORDER BY id ASC",[channel,limit], function(error,results,fields) {
			if(error) {
				winston.error("getEvents: Select failed! "+error);
				callback([]);
			}
			else callback(results);
		});
	}
	
	self.getLeaderboard = function(channel, offset, limit, callback) {
		self.pool.query("SELECT * FROM ?? ORDER BY messages DESC LIMIT ? OFFSET ?",["users_"+channel,limit,offset], function(error,results,fields) {
			if(error) {
				winston.error("getLeaderboard: Select failed! "+error);
				callback([]);
			}
			else callback(results);
		});
	}
	
	// connections
	/*
		id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
		channel VARCHAR(32) NULL,
		active tinyint(4) unsigned NOT NULL DEFAULT '1',
		type VARCHAR(32) NOT NULL PRIMARY KEY, // name of the app (for example "Slack")
		data VARCHAR(256) NULL, // identifier of the application (used to identify the location the request came from)
		description TEXT NULL // Full-text description
	
	self.getIntegrations = function(channel, callback) {
		self.pool.query("SELECT * FROM connections WHERE channel=?",[channel], function(error,results,fields) {
			callback(results);
		});
	}
	
	self.getIntegration = function(channel, id, callback) {
		self.pool.query("SELECT * FROM connections WHERE channel=? AND id=?",["users_"+channel, searchString], function(error,results,fields) {
			callback(results[0]);
		});
	}
	
	self.addConnection = function(channel, active, type, data, description, callback) {
		self.pool.query("INSERT INTO connections(channel, active, type, data, description) VALUES (?,?,?,?,?)",[channel, active, type, data, description], function(error, result) {
			if(error) {
				winston.error("addLine: Could not insert! "+error);
				return;
			}
			if(callback) callback(result.insertId);
		});
	}
	
	self.updateConnection = function(channel, id, active, type, data, description, callback) {
		self.pool.query("UPDATE connections SET active=?, type=?, data=?, description=? WHERE id=? AND channel=?",[active, type, data, description, id, channel], function(error,results,fields) {
			if(callback) callback(results);
		});
	}
	
	self.removeConnection = function(channel, id, callback, callback) {
		self.pool.query("DELETE FROM connections WHERE channel=? AND id=?",[channel, id], function(error,results,fields) {
			if(callback) callback(results);
		});
	}
	*/
	// error handling
	self.pool.on('error', function(err) {
		winston.error(err);
	});
}

