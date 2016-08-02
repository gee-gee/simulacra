/*!
 * Simulacra.js
 * Version 1.2.4
 * MIT License
 * https://github.com/0x8890/simulacra
 */
(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
'use strict'

var processNodes = require('./process_nodes')
var keyMap = require('./key_map')

var markerMap = processNodes.markerMap
var hasDefinitionKey = keyMap.hasDefinition
var isBoundToParentKey = keyMap.isBoundToParent
var replaceAttributeKey = keyMap.replaceAttribute
var retainElementKey = keyMap.retainElement

// This is a global store that keeps the previously assigned values of keys
// on objects. It is keyed by the bound object and valued by a memoized object
// that contains the same keys.
var storeMemo = new WeakMap()

// Internal meta-information about objects.
var storeMeta = new WeakMap()


module.exports = bindKeys


/**
 * Define getters & setters. This function is the internal entry point to a lot
 * of functionality.
 *
 * @param {*} [scope]
 * @param {Object} obj
 * @param {Object} def
 * @param {Node} parentNode - This is not the same as
 * `Node.prototype.parentNode`, this is the internal parent node if the key
 * was bound to its parent.
 * @param {Array} path
 */
function bindKeys (scope, obj, def, parentNode, path) {
  var i, j, meta, keys, key, keyPath

  if (typeof obj !== 'object' || obj === null)
    throw new TypeError(
      'Invalid type of value "' + obj + '", object expected.')

  storeMemo.set(obj, {})

  meta = {}
  storeMeta.set(obj, meta)

  keys = Object.keys(def)
  for (i = 0, j = keys.length; i < j; i++) {
    key = keys[i]

    keyPath = path.concat(key)
    keyPath.root = path.root
    keyPath.target = obj

    meta[key] = {
      keyPath: keyPath,
      activeNodes: [],
      previousValues: [],
      valueIsArray: null
    }

    bindKey(scope, obj, def, key, parentNode, path)
  }
}


// This is an internal function, the arguments aren't pretty.
function bindKey (scope, obj, def, key, parentNode, path) {
  var document = scope ? scope.document : window.document
  var memo = storeMemo.get(obj)
  var meta = storeMeta.get(obj)[key]
  var branch = def[key]
  var node = branch[0]
  var change = !branch[hasDefinitionKey] && branch[1]
  var definition = branch[hasDefinitionKey] && branch[1]
  var mount = branch[2]
  var marker = markerMap.get(branch)

  // Temporary keys.
  var keyPath = meta.keyPath
  var activeNodes = meta.activeNodes
  var previousValues = meta.previousValues
  var valueIsArray = meta.valueIsArray

  // For initialization, call this once.
  if (branch[isBoundToParentKey]) parentSetter(obj[key])
  else setter(obj[key])

  Object.defineProperty(obj, key, {
    get: getter,
    set: branch[isBoundToParentKey] ? parentSetter : setter,
    enumerable: true,
    configurable: true
  })

  function getter () { return memo[key] }

  // Special case for binding same node as parent.
  function parentSetter (x) {
    var previousValue = memo[key]

    // Check for no-op.
    if (x === previousValue) return x

    // Need to qualify this check for non-empty value.
    if (definition && x != null)
      bindKeys(scope, x, definition, parentNode, keyPath)

    else if (change)
      change(parentNode, x, previousValue, keyPath)

    // If nothing went wrong, set the memoized value.
    memo[key] = x

    return x
  }

  function setter (x) {
    var fragment, value, currentNode
    var a, b, i, j

    valueIsArray = meta.valueIsArray = Array.isArray(x)
    value = valueIsArray ? x : [ x ]

    // Assign custom mutator methods on the array instance.
    if (valueIsArray) {
      // Some mutators such as `sort`, `reverse`, `fill`, `copyWithin` are
      // not present here. That is because they trigger the array index
      // setter functions by assigning on them internally.

      // These mutators may alter length.
      value.pop = pop
      value.push = push
      value.shift = shift
      value.unshift = unshift
      value.splice = splice

      // Handle array index assignment.
      for (i = 0, j = value.length; i < j; i++)
        defineIndex(value, i)
    }

    // Handle rendering to the DOM. This algorithm tries to batch insertions
    // into as few document fragments as possible.
    for (i = 0, j = Math.max(previousValues.length, value.length);
      i < j; i++) {
      a = value[i]
      b = previousValues[i]
      currentNode = a !== b ? replaceNode(a, b, i) : null

      if (currentNode) {
        if (!fragment) fragment = document.createDocumentFragment()
        fragment.appendChild(currentNode)
        continue
      }

      // If the value was empty and a current fragment exists, need to insert
      // the current document fragment.
      if (!fragment) continue

      marker.parentNode.insertBefore(fragment,
        getNextNode(i + 1, activeNodes) || marker)
    }

    // Terminal behavior.
    if (fragment)
      marker.parentNode.insertBefore(fragment, marker)

    // Reset length to current values, implicitly deleting indices and
    // allowing for garbage collection.
    if (value.length !== previousValues.length)
      previousValues.length = activeNodes.length = value.length

    // If nothing went wrong, set the memoized value.
    memo[key] = x

    return x
  }

  function defineIndex (array, i) {
    var value = array[i]

    Object.defineProperty(array, i, {
      get: function () { return value },
      set: function (x) {
        var a, b, currentNode

        value = x
        a = array[i]
        b = previousValues[i]

        if (a !== b) currentNode = replaceNode(a, b, i)

        if (currentNode)
          marker.parentNode.insertBefore(currentNode,
            getNextNode(i + 1, activeNodes) || marker)
      },
      enumerable: true,
      configurable: true
    })
  }

  function removeNode (value, previous, i) {
    var activeNode = activeNodes[i]
    var endPath = keyPath
    var returnValue

    // Cast previous value to null if undefined.
    var previousValue = previous === void 0 ? null : previous

    delete previousValues[i]

    if (activeNode) {
      if (valueIsArray) endPath = addToPath(path, keyPath, i)

      if (change)
        returnValue = change(activeNode, null, previousValue, endPath)
      else if (definition && mount) {
        findTarget(endPath, keyPath)
        returnValue = mount(activeNode, null, previousValue, endPath)
      }

      // If a change or mount function returns the retain element symbol,
      // skip removing the element from the DOM.
      if (returnValue !== retainElementKey)
        marker.parentNode.removeChild(activeNode)

      delete activeNodes[i]
    }
  }

  // The return value of this function is a Node to be added, otherwise null.
  function replaceNode (value, previous, i) {
    var activeNode = activeNodes[i]
    var currentNode = node
    var endPath = keyPath
    var returnValue

    // Cast previous value to null if undefined.
    var previousValue = previous === void 0 ? null : previous

    // If value is undefined or null, just remove it.
    if (value == null) {
      removeNode(null, previousValue, i)
      return null
    }

    if (valueIsArray) endPath = addToPath(path, keyPath, i)

    previousValues[i] = value

    if (definition) {
      if (activeNode) removeNode(value, previousValue, i)
      currentNode = processNodes(scope, node, definition)
      endPath.target = valueIsArray ? value[i] : value
      bindKeys(scope, value, definition, currentNode, endPath)
      if (mount) {
        findTarget(endPath, keyPath)
        mount(currentNode, value, null, endPath)
      }
    }

    else {
      currentNode = activeNode || node.cloneNode(true)
      returnValue = change ?
        change(currentNode, value, previousValue, endPath) :
        value !== void 0 ? value : null

      if (returnValue !== void 0)
        changeValue(currentNode, returnValue, branch[replaceAttributeKey])
    }

    // Do not actually add an element to the DOM if it's only a change
    // between non-empty values.
    if (!definition && activeNode) return null

    activeNodes[i] = currentNode

    return currentNode
  }


  // Below are optimized array mutator methods. They have to exist within
  // this closure. Note that the native implementations of these methods do
  // not trigger setter functions on array indices.

  function pop () {
    var i = this.length - 1
    var previousValue = previousValues[i]
    var value = Array.prototype.pop.call(this)

    removeNode(null, previousValue, i)
    previousValues.length = activeNodes.length = this.length

    return value
  }

  function push () {
    var i = this.length
    var j, fragment, currentNode

    // Passing arguments to apply is fine.
    var value = Array.prototype.push.apply(this, arguments)

    if (arguments.length) {
      fragment = document.createDocumentFragment()

      for (j = i + arguments.length; i < j; i++) {
        currentNode = replaceNode(this[i], null, i)
        if (currentNode) fragment.appendChild(currentNode)
        defineIndex(this, i)
      }

      marker.parentNode.insertBefore(fragment, marker)
    }

    return value
  }

  function shift () {
    removeNode(null, previousValues[0], 0)

    Array.prototype.shift.call(previousValues)
    Array.prototype.shift.call(activeNodes)

    return Array.prototype.shift.call(this)
  }

  function unshift () {
    var i = this.length
    var j, k, fragment, currentNode

    // Passing arguments to apply is fine.
    var value = Array.prototype.unshift.apply(this, arguments)

    Array.prototype.unshift.apply(previousValues, arguments)
    Array.prototype.unshift.apply(activeNodes, Array(k))

    if (arguments.length) {
      fragment = document.createDocumentFragment()

      for (j = 0, k = arguments.length; j < k; j++) {
        currentNode = replaceNode(arguments[j], null, j)
        if (currentNode) fragment.appendChild(currentNode)
      }

      for (j = i + arguments.length; i < j; i++) defineIndex(this, i)

      marker.parentNode.insertBefore(fragment,
        getNextNode(arguments.length, activeNodes) || marker)
    }

    return value
  }

  function splice (start, count) {
    var insert = []
    var i, j, k, fragment, value, currentNode

    for (i = start, j = start + count; i < j; i++)
      removeNode(null, previousValues[i], i)

    for (i = 2, j = arguments.length; i < j; i++)
      insert.push(arguments[i])

    // Passing arguments to apply is fine.
    Array.prototype.splice.apply(previousValues, arguments)

    // In this case, avoid setting new values.
    Array.prototype.splice.apply(activeNodes,
      [ start, count ].concat(Array(insert.length)))

    value = Array.prototype.splice.apply(this, arguments)

    if (insert.length) {
      fragment = document.createDocumentFragment()

      for (i = start + insert.length - 1, j = start; i >= j; i--) {
        currentNode = replaceNode(insert[i - start], null, i)
        if (currentNode) fragment.appendChild(currentNode)
      }

      marker.parentNode.insertBefore(fragment,
        getNextNode(start + insert.length, activeNodes) || marker)
    }

    k = insert.length - count

    if (k < 0)
      previousValues.length = activeNodes.length = this.length

    else if (k > 0)
      for (i = this.length - k, j = this.length; i < j; i++)
        defineIndex(this, i)

    return value
  }
}


// Default behavior when a return value is given for a change function.
function changeValue (node, value, attribute) {
  switch (attribute) {
  case 'checked':
    if (value) node.checked = 'checked'
    else node.removeAttribute('checked')
    break
  default:
    node[attribute] = value
  }
}


// Find next node.
function getNextNode (index, activeNodes) {
  var i, j, nextNode

  for (i = index, j = activeNodes.length; i < j; i++)
    if (activeNodes[i]) {
      nextNode = activeNodes[i]
      break
    }

  return nextNode
}


// Add index to the end of a path.
function addToPath (path, keyPath, i) {
  var endPath = keyPath.concat(i)

  endPath.root = path.root
  endPath.target = path.target

  return endPath
}


// Update the target.
function findTarget (endPath, keyPath) {
  var i, j

  endPath.target = endPath.root

  for (i = 0, j = keyPath.length - 1; i < j; j++)
    endPath.target = endPath.target[keyPath[i]]
}

},{"./key_map":3,"./process_nodes":4}],2:[function(require,module,exports){
'use strict'

var processNodes = require('./process_nodes')
var bindKeys = require('./bind_keys')
var keyMap = require('./key_map')

var isArray = Array.isArray
var hasDefinitionKey = keyMap.hasDefinition
var replaceAttributeKey = keyMap.replaceAttribute
var isBoundToParentKey = keyMap.isBoundToParent
var isProcessedKey = keyMap.isProcessed

// Node names which should have value replaced.
var replaceValue = [ 'INPUT', 'TEXTAREA', 'PROGRESS' ]

// Input types which use the "checked" attribute.
var replaceChecked = [ 'checkbox', 'radio' ]

// Symbol for retaining an element instead of removing it.
Object.defineProperty(simulacra, 'retainElement', {
  enumerable: true, value: keyMap.retainElement
})

// Option to use comment nodes as markers.
Object.defineProperty(simulacra, 'useCommentNode', {
  get: function () { return processNodes.useCommentNode },
  set: function (value) { processNodes.useCommentNode = value },
  enumerable: true
})


module.exports = simulacra


/**
 * Bind an object to the DOM.
 *
 * @param {Object} obj
 * @param {Object} def
 * @return {Node}
 */
function simulacra (obj, def) {
  var document = this ? this.document : window.document
  var Node = this ? this.Node : window.Node
  var node, query, path

  featureCheck(this || window)

  if (obj === null || typeof obj !== 'object' || isArray(obj))
    throw new TypeError('First argument must be a singular object.')

  if (!isArray(def))
    throw new TypeError('Second argument must be an array.')

  if (typeof def[0] === 'string') {
    query = def[0]
    def[0] = document.querySelector(query)
    if (!def[0]) throw new Error(
      'Top-level node "' + query + '" could not be found in the document.')
  }
  else if (!(def[0] instanceof Node)) throw new TypeError(
    'The first position of top-level must be a Node or a CSS selector string.')

  if (!def[isProcessedKey]) {
    ensureNodes(this, def[0], def[1])
    setFrozen(def)
  }

  node = processNodes(this, def[0], def[1])

  path = []
  path.root = obj
  bindKeys(this, obj, def[1], node, path)

  return node
}


/**
 * Internal function to mutate string selectors into Nodes and validate that
 * they are allowed.
 *
 * @param {Object} [scope]
 * @param {Node} parentNode
 * @param {Object} def
 */
function ensureNodes (scope, parentNode, def) {
  var Element = scope ? scope.Element : window.Element
  var adjacentNodes = []
  var i, j, defKeys, key, query, branch, boundNode, ancestorNode

  if (typeof def !== 'object') throw new TypeError(
    'The second position must be an object.')

  defKeys = Object.keys(def)

  for (i = 0, j = defKeys.length; i < j; i++) {
    key = defKeys[i]
    branch = def[key]

    // Change function or definition object bound to parent.
    if (typeof branch === 'function' || (typeof branch === 'object' &&
      branch !== null && !Array.isArray(branch)))
      def[key] = branch = [ parentNode, branch ]

    // Cast CSS selector string to array.
    else if (typeof branch === 'string') def[key] = branch = [ branch ]

    else if (!Array.isArray(branch))
      throw new TypeError('The binding on key "' + key + '" is invalid.')

    // Dereference CSS selector string to actual DOM Node.
    if (typeof branch[0] === 'string') {
      query = branch[0]

      // May need to get the node above the parent, in case of binding to
      // the parent node.
      ancestorNode = parentNode.parentNode || parentNode

      branch[0] = ancestorNode.querySelector(query)
      if (!branch[0]) throw new Error(
        'The element for selector "' + query + '" was not found.')
    }
    else if (!(branch[0] instanceof Element))
      throw new TypeError('The first position on key "' + key +
        '" must be a DOM element or a CSS selector string.')

    boundNode = branch[0]

    if (typeof branch[1] === 'object' && branch[1] !== null) {
      Object.defineProperty(branch, hasDefinitionKey, { value: true })
      if (branch[2] && typeof branch[2] !== 'function')
        throw new TypeError('The third position on key "' + key +
          '" must be a function.')
    }
    else if (branch[1] && typeof branch[1] !== 'function')
      throw new TypeError('The second position on key "' + key +
        '" must be an object or a function.')

    // Special case for binding to parent node.
    if (parentNode === boundNode) {
      Object.defineProperty(branch, isBoundToParentKey, { value: true })
      if (branch[hasDefinitionKey]) ensureNodes(scope, boundNode, branch[1])
      else if (typeof branch[1] !== 'function')
        console.warn( // eslint-disable-line
          'A change function was not defined on the key "' + key + '".')
      setFrozen(branch)
      continue
    }
    else adjacentNodes.push([ key, boundNode ])

    if (!parentNode.contains(boundNode))
      throw new Error('The bound DOM element must be either ' +
        'contained in or equal to the element in its parent binding.')

    if (branch[hasDefinitionKey]) {
      ensureNodes(scope, boundNode, branch[1])
      setFrozen(branch)
      continue
    }

    Object.defineProperty(branch, replaceAttributeKey, {
      value: ~replaceValue.indexOf(boundNode.nodeName) ?
        ~replaceChecked.indexOf(boundNode.type) ?
        'checked' : 'value' : 'textContent'
    })

    setFrozen(branch)
  }

  // Need to loop again to invalidate containment in adjacent nodes, after the
  // adjacent nodes are found.
  for (i = 0, j = defKeys.length; i < j; i++) {
    key = defKeys[i]
    boundNode = def[key][0]
    for (i = 0, j = adjacentNodes.length; i < j; i++)
      if (adjacentNodes[i][1].contains(boundNode) &&
        adjacentNodes[i][1] !== boundNode)
        throw new Error(
          'The element for key "' + key + '" is contained in the ' +
          'element for the adjacent key "' + adjacentNodes[i][0] + '".')
  }

  // Freeze the definition.
  setFrozen(def)
}


function setFrozen (obj) {
  Object.defineProperty(obj, isProcessedKey, { value: true })
  Object.freeze(obj)
}


// Feature checks.
function featureCheck (globalScope) {
  var features = [
    // ECMAScript features.
    [ Object, 'defineProperty' ],
    [ Object, 'freeze' ],
    [ Object, 'isFrozen' ],
    [ WeakMap ],

    // DOM features.
    [ 'document', 'createDocumentFragment' ],
    [ 'document', 'createTreeWalker' ],
    [ 'Node', 'prototype', 'appendChild' ],
    [ 'Node', 'prototype', 'contains' ],
    [ 'Node', 'prototype', 'insertBefore' ],
    [ 'Node', 'prototype', 'isEqualNode' ],
    [ 'Node', 'prototype', 'removeChild' ]
  ]
  var i, j, k, l, feature, path

  for (i = 0, j = features.length; i < j; i++) {
    path = features[i]

    if (typeof path[0] === 'string') {
      feature = globalScope

      for (k = 0, l = path.length; k < l; k++) {
        if (!(path[k] in feature)) throw new Error('Missing ' +
          path.slice(0, k + 1).join('.') + ' feature which is required.')

        feature = feature[path[k]]
      }
    }

    else {
      feature = path[0]

      for (k = 1, l = path.length; k < l; k++) {
        if (k > 1) feature = feature[path[k]]

        if (typeof feature === 'undefined') throw new Error('Missing ' +
          path[0].name + path.slice(1, k + 1).join('.') +
          ' feature which is required.')
      }
    }
  }
}

},{"./bind_keys":1,"./key_map":3,"./process_nodes":4}],3:[function(require,module,exports){
'use strict'

var keys = [
  'hasDefinition',
  'isBoundToParent',
  'isProcessed',
  'replaceAttribute',
  'retainElement'
]

var keyMap = {}
var hasSymbol = typeof Symbol === 'function'
var i, j

for (i = 0, j = keys.length; i < j; i++)
  keyMap[keys[i]] = hasSymbol ?
    Symbol(keys[i]) : '__' + keys[i] + '__'

module.exports = keyMap

},{}],4:[function(require,module,exports){
'use strict'

var keyMap = require('./key_map')

var isBoundToParentKey = keyMap.isBoundToParent

// Map from definition branches to marker nodes. This is necessary because the
// definitions are frozen and cannot be written to.
var markerMap = processNodes.markerMap = new WeakMap()

// Option to use comment nodes as markers.
processNodes.useCommentNode = false


module.exports = processNodes


/**
 * Internal function to remove bound nodes and replace them with markers.
 *
 * @param {*} [scope]
 * @param {Node} node
 * @param {Object} def
 * @return {Node}
 */
function processNodes (scope, node, def) {
  var document = scope ? scope.document : window.document
  var defKeys = Object.keys(def)
  var i, j, branch, key, mirrorNode, parent, marker, map

  node = node.cloneNode(true)
  map = matchNodes(scope, node, def)

  for (i = 0, j = defKeys.length; i < j; i++) {
    key = defKeys[i]
    branch = def[key]
    if (branch[isBoundToParentKey]) continue

    mirrorNode = map.get(branch[0])
    parent = mirrorNode.parentNode

    if (processNodes.useCommentNode) {
      marker = parent.insertBefore(document.createComment(
          ' end "' + key + '" '), mirrorNode)
      parent.insertBefore(document.createComment(
        ' begin "' + key + '" '), marker)
    }
    else marker = parent.insertBefore(
      document.createTextNode(''), mirrorNode)

    markerMap.set(branch, marker)

    parent.removeChild(mirrorNode)
  }

  return node
}


/**
 * Internal function to find matching DOM nodes on cloned nodes.
 *
 * @param {*} [scope]
 * @param {Node} node
 * @param {Object} def
 * @return {WeakMap}
 */
function matchNodes (scope, node, def) {
  var document = scope ? scope.document : window.document
  var NodeFilter = scope ? scope.NodeFilter : window.NodeFilter
  var treeWalker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT)
  var map = new WeakMap()
  var defKeys = Object.keys(def)
  var nodes = []
  var i, j, currentNode

  for (i = 0, j = defKeys.length; i < j; i++) nodes.push(def[defKeys[i]][0])

  while (treeWalker.nextNode() && nodes.length)
    for (i = 0, j = nodes.length; i < j; i++) {
      currentNode = nodes[i]
      if (treeWalker.currentNode.isEqualNode(currentNode)) {
        map.set(currentNode, treeWalker.currentNode)
        nodes.splice(i, 1)
        break
      }
    }

  return map
}

},{"./key_map":3}],5:[function(require,module,exports){
window.simulacra = require('../lib/index')

},{"../lib/index":2}]},{},[5]);
