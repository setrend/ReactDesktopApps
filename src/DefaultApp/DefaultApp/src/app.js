// A '.tsx' file enables JSX support in the TypeScript compiler, 
// for more information see the following page on the TypeScript wiki:
// https://github.com/Microsoft/TypeScript/wiki/JSX
/// <reference path='../typings/browser.d.ts'/>
System.register(['react-dom', 'react', './hello'], function(exports_1, context_1) {
    "use strict";
    var __moduleName = context_1 && context_1.id;
    var __extends = (this && this.__extends) || function (d, b) {
        for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
    var ReactDOM, React, hello_1;
    var App;
    return {
        setters:[
            function (ReactDOM_1) {
                ReactDOM = ReactDOM_1;
            },
            function (React_1) {
                React = React_1;
            },
            function (hello_1_1) {
                hello_1 = hello_1_1;
            }],
        execute: function() {
            App = (function (_super) {
                __extends(App, _super);
                function App(props, context) {
                    _super.call(this, props, context);
                }
                App.prototype.handleAbout = function () {
                    window.nativeHost.showAbout();
                };
                App.prototype.handleToggleWindow = function () {
                    window.nativeHost.toggleFormBorder();
                };
                App.prototype.handleQuit = function () {
                    window.nativeHost.quit();
                };
                App.prototype.render = function () {
                    return (React.createElement("div", null, React.createElement("div", {className: "navbar navbar-inverse", role: "navigation"}, React.createElement("div", {className: "container"}, React.createElement("div", {className: "navbar-header"}, React.createElement("button", {type: "button", className: "navbar-toggle", "data-toggle": "collapse", "data-target": ".navbar-collapse"}, React.createElement("span", {className: "sr-only"}, "Toggle navigation"), React.createElement("span", {className: "icon-bar"}), React.createElement("span", {className: "icon-bar"}), React.createElement("span", {className: "icon-bar"})), React.createElement("a", {className: "navbar-brand", href: "/"}, React.createElement("img", {src: "/img/react-logo.png"}), "DefaultApp v1.1")), React.createElement("div", {className: "navbar-collapse collapse"}, React.createElement("ul", {className: "nav navbar-nav pull-right"}, React.createElement("li", null, React.createElement("a", {onClick: this.handleAbout}, "About")), React.createElement("li", {className: "platform winforms"}, React.createElement("a", {onClick: this.handleToggleWindow}, "Toggle Window")), React.createElement("li", {className: "platform winforms mac console"}, React.createElement("a", {onClick: this.handleQuit}, "Close")))))), React.createElement("div", {className: "container"}, React.createElement(hello_1.default, null))));
                };
                return App;
            }(React.Component));
            ReactDOM.render(React.createElement(App, null), document.getElementById('content'));
        }
    }
});
//# sourceMappingURL=app.js.map