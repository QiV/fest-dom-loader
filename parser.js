var sax = require('sax');
var fs = require('fs');
var path = require('path');
var log = console.error;
var jschars = /['"\n\r\t\b\f]/g;
var jshash = {
  '"': '\\"',
  '\'': '\\\'',
  '\\': '\\\\',
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
  '\b': '\\b',
  '\f': '\\f'
};
var reName = /^(?!(?:do|if|in|for|let|new|try|var|case|else|enum|eval|false|null|this|true|void|with|break|catch|class|const|super|throw|while|yield|delete|export|import|public|return|static|switch|typeof|default|extends|finally|package|private|continue|debugger|function|arguments|interface|protected|implements|instanceof)$)[$A-Z\_a-z][$A-Z\_a-z0-9]*$/;

module.exports = Parser;

function Parser(opts) {
  var strict = true;// set to false for html-mode
  var options = {
    //doLooseCase: false,
    strictEntities: true,
    normalize: true,
    trim: true,
    xmlns: true,
    noscript: true
  };
  var parser = sax.parser(strict, options);
  parser.onopentag = require('./events/onopentag');
  parser.onclosetag = require('./events/onclosetag');
  parser.onerror = require('./events/onerror');
  parser.oncdata = require('./events/oncdata');
  parser.ontext = require('./events/ontext');
  parser.onscript = require('./events/onscript');
  //parser.onattribute = onattribute;
  parser.onend = require('./events/onend');
  parser.log = log;

  parser.expressions = [];
  parser.exprCnt = 0;
  parser.source = [];
  parser.nodeNamesStack = [];
  //parser.nodeStack = [];
  parser.subClass = [];
  parser.subClassIndex = {};
  parser.festStack = [];
  parser.forwarding = {};
  parser.types = {};
  parser.el = {};
  parser.attr = [];
  parser.elConf = {};

  parser.classes = [];// ./class-tmpl.js instanses

  var defaults = {
    lang: 'js',
    path: 'fest-dom-loader/base',
    name: 'tmpl'
  };
  parser.opts = extend(defaults, opts);
  parser.lang = parser.opts.lang;
  parser.CONCAT = {
    js: '+',
    lua: '..',
    xslate: '~'
  }[parser.lang];

  parser.festTags = require('./tags/fest');
  parser.htmlTags = require('./tags/html');
  parser.escapeJS = escapeJS;
  parser.arrayToPath = function(pos) {
    return pos;
    //return 'root.childNodes[' + pos.join('].childNodes[') + ']';
  };

  this.parser = parser;
}

Parser.prototype.write = function (xmlString, filepath) {
  this.parser.getEval = getEval(xmlString, this.parser, filepath);
  this.parser.getExpr = getExpr(xmlString, this.parser, filepath);
  this.parser.getAttr = getAttr(xmlString, this.parser, filepath);
  this.parser.filepath = filepath;
  this.parser.write(xmlString).close();
  return this;
};

Parser.prototype.getSource = function () {
  var output;
  if (this.parser.lang === 'lua') {
    output = fs.readFileSync(path.join(__dirname, 'tmpl.lua')).toString()
      .replace(/__VARS__/, this.parser.expressions.join('\n') || '')
      .replace(/__SOURCE__/, this.parser.source.join('..') || '""')
      .replace(/"\.\."/g, '');
  } else if (this.parser.lang === 'Xslate') {
    output = this.parser.source.join('').replace(/:><:/g, '\n');
  } else {
    output = fs.readFileSync(path.join(__dirname, 'tmpl.js')).toString()
      .replace('__TemplatePath__', this.parser.opts.path)
      .replace('__CLASSES__', this.parser.classes.join(';\n'));
  }

  return new Buffer(output);
};

function escapeJS(s) {
  return s.replace(jschars, function (chr) {
    return jshash[chr];
  });
}
function getEval(compileFile, parser, filepath) {
  return function (value) {
    try {
      (new Function(value));
    } catch (e) {
      throw new Error(errorMessage('node has ' + e, parser.line, compileFile, filepath));
    }
    return value;
  };
}
function getExpr(compileFile, parser, filepath) {
  return function (value, where) {
    try {
      value = value.replace(/;+\s*$/, '');
      (new Function('(' + value + ')'));
    } catch (e) {
      throw new Error(errorMessage((where || 'node') + ' has ' + e, parser.line, compileFile, filepath));
    }
    return value;
  }
}
function getAttr(compileFile, parser, filepath) {
  return function (node, attr, type) {
    var value;
    try {
      value = node.attributes[attr].value;
    } catch (e) {
      throw new Error(errorMessage('attribute "' + attr + '" is missing', parser.line, compileFile, filepath));
    }
    if (type === 'expr') {
      try {
        (new Function('(' + value + ')'));
      } catch (e) {
        throw new Error(errorMessage('attribute "' + attr + '" has ' + e, parser.line, compileFile, filepath));
      }
    } else if (type === 'var') {
      if (!reName.test(value)) {
        throw new Error(errorMessage('attribute "' + attr + '" has an invalid identifier', parser.line, compileFile, filepath));
      }
    }
    if (node.lang === 'lua') {
      value = getLuaExpr(value);
    }
    return value;
  };
}
function errorMessage(msg, badLine, file, filepath) {
  function zeroPadding(s, len) {
    if (s.toString().length >= len) {
      return s + '';
    }
    return String(new Array(len + 1).join('0') + s).slice(-len);
  }

  function numSort(a, b) {
    return a - b;
  }

  function leftWhitespace(s) {
    return s.length - s.trimLeft().length;
  }

  var before = 1,
    after = 1,
    lines = file.split('\n'),
    badPlace = [],
    num = [];

  for (var i = badLine - before; i <= badLine + after; i++) {
    if (lines[i] !== undefined) {
      num.push(i);
    }
  }

  var longest = num.sort(numSort)[num.length - 1].toString().length,
    minWhitespace = num.slice(0)
      .map(function (n) {
        return leftWhitespace(lines[n]);
      })
      .sort(numSort)[0];

  num.forEach(function (n) {
    badPlace.push(
      ('%n%: ' + lines[n].slice(minWhitespace)).replace('%n%', zeroPadding(n + 1, longest))
    );
  });

  return ['', 'file: ' + filepath, badPlace.join('\n'), 'At line ' + zeroPadding(badLine + 1, longest) + ': ' + msg].join('\n');
}
function extend (original, extended) {
  extended = extended || {};
  for (var key in extended) {
    original[key] = extended[key];
  }
  return original;
}
function getLuaExpr(val) {
  val = val
    .replace(/\&\&/g, ' and ')
    .replace(/\|\|/g, ' or ')
    .replace(/\!/g, ' not ');

  if (val.indexOf('?') === -1) {
    val = val.replace(/\:/g, '='); // object notation
  } else {
    val = val.replace(/\:/g, ' or '); // ternar operator
  }
  val = val.replace(/\?/g, ' and ');
  return val;
}
