function ppSpoofFlash()
{
	var p = { description: "Shockwave Flash 32.0 r0" };
	navigator.plugins["Shockwave Flash"] = p;
	navigator.mimeTypes["application/x-shockwave-flash"] = { enabledPlugin: p };
}
ppSpoofFlash();
function assert(cond)
{
	if(!cond)
		debugger
}
var ppUrlFilterCb = null;
var ppLocationHref = location.href;
var ppCheerpXAppOpts = {};
function cheerpjGetStackEntry(s)
{
	var frames=s.split("  at ");
	if(frames.length == 1)
	{
		// It was not chrome probably, try again
		frames=s.split("@");
	}
	var firstFrame=frames[1];
	var path=firstFrame.split('.js:')[0]+".js";
	return path;
}

function cjGetCurrentScript()
{
	try
	{
		throw new Error();
	}
	catch(e)
	{
		var stack = e.stack;
	}
	var part=cheerpjGetStackEntry(stack);
	var loaderStart = part.indexOf("http://");
	if(loaderStart == -1)
		loaderStart = part.indexOf("https://");
	var loaderEnd = part.indexOf(".js");
	assert(loaderStart >= 0 && loaderEnd > 0);
	return part.substring(loaderStart, loaderEnd+3);
}

function ppGetObjectOrEmbedParams(elem)
{
	var params = null;
	if(elem.tagName == "OBJECT")
	{
		var swfFile = elem.getAttribute("data");
		params = {src: swfFile};
		for(var i=0;i<elem.children.length;i++)
		{
			var c = elem.children[i];
			if(c.nodeName.toLowerCase() != "param")
				continue;
			var name = c.getAttribute("name");
			var value = c.getAttribute("value");
			if(name == null || value == null)
				continue;
			params[name] = value;
		}
	}
	else if(elem.tagName == "EMBED")
	{
		params = {};
		var attrs = elem.attributes;
		for(var i=0;i<attrs.length;i++)
		{
			var a = attrs[i];
			params[a.name] = a.value;
		}
	}
	return params;
}
function ppHandleMessage(e)
{
	if(e.data.t == "init")
	{
		if(this.ppParams.src == null)
			return;
		// The iframe is ready, send over the parameter from the replaced object
		this.postMessage({t:"params", href: ppLocationHref, params:this.ppParams});
	}
	else if(e.data.t == "openurl")
	{
		let init = {
			method: e.data.method==0 ? "GET" : "POST",
			body: e.data.data,
		};
		let headers = new Headers();
		if(e.data.headers)
		{
			for(let h of e.data.headers.split("\n"))
			{
				var lSplit = h.indexOf(': ');
				if(lSplit < 0)
					continue;
				var k = h.substr(0, lSplit);
				var v = h.substr(lSplit+2);
				headers.append(k, v);
			}
		}
		let handleOpenError = (err) => {
			this.postMessage({
				t:"openurlfailed",
				entryId: e.data.entryId,
				callbackId: e.data.callbackId,
			});
		};
		let handleReceiveError = (err) => {
			this.postMessage({
				t:"openurlreceivefailed",
				entryId: e.data.entryId,
			});
		};
		var url = e.data.url;
		if(ppUrlFilterCb && init.method == "GET")
		{
			var newHeaders = {};
			url = ppUrlFilterCb(url, newHeaders);
			for(var p in newHeaders)
			{
				headers.append(p, newHeaders[p]);
			}
		}
		init.headers = headers;
		fetch(url, init).then((resp) =>
		{
			let headers = new Map(resp.headers);
			this.postMessage({
				t:"openurlstarted",
				entryId: e.data.entryId,
				callbackId: e.data.callbackId,
				responseURL: ppUrlFilterCb ? e.data.url : resp.url,
				status: resp.status,
				responseHeaders: headers,
				redirected: resp.redirected,
			});
			let reader = resp.body.getReader();
			let readChunk = ({done, value}) =>
			{
				if(done)
				{
					this.postMessage({
						t:"openurldone",
						entryId: e.data.entryId,
						callbackId: e.data.callbackId,
						progressId: e.data.progressId,
					});
					return;
				}
				this.postMessage({
					t:"openurlreceive",
					entryId: e.data.entryId,
					callbackId: e.data.callbackId,
					progressId: e.data.progressId,
					data: value,
				});
				reader.read().then(readChunk).catch(handleReceiveError);
			};
			reader.read().then(readChunk).catch(handleReceiveError);
		})
		.catch(handleOpenError);
	}
	else if(e.data.t == "executesync")
	{
		var r = self.eval(e.data.script);
		this.postMessage({t:"executeret", ret: r});
	}
	else if(e.data.t == "open")
	{
		window.open(e.data.url, e.data.target);
	}
	else
	{
		debugger;
	}
}
function rewriteFlashObject(obj, options)
{
	if(obj.parentNode == null)
		return false;
	var objParams = ppGetObjectOrEmbedParams(obj);
	if(objParams == null || objParams.src == null)
		return false;
	var c = new MessageChannel();
	c.port1.onmessage = ppHandleMessage;
	c.port1.ppParams = objParams;
	c.port1.ppOtherPort = c.port2;
	var f = document.createElement("iframe");
	f.setAttribute("allow", "clipboard-read; clipboard-write");
	f.onload = function(e)
	{
		f.contentWindow.postMessage({t:"port",port:c.port2, options: options}, "*", [c.port2]);
	};
	var ppPath = cjGetCurrentScript();
	assert(ppPath.endsWith("/pp.js"));
	f.src = ppPath.substr(0, ppPath.length - 2) + "html";
	var v = null;
	if(v = obj.getAttribute("id"))
		f.setAttribute("id", v);
	if(v = obj.getAttribute("name"))
		f.setAttribute("name", v);
	if(v = obj.getAttribute("style"))
		f.setAttribute("style", v);
	if(v = obj.getAttribute("class"))
		f.setAttribute("class", v);
	if(v = obj.getAttribute("width"))
		f.setAttribute("width", v);
	if(v = obj.getAttribute("height"))
		f.setAttribute("height", v);
	f.style.border = "0";
	obj.parentNode.replaceChild(f, obj);
	var oldProto = f.__proto__;
	var handlers = {
		get:function(t, p, r)
		{
			var ret=Reflect.get(...arguments);
			if(ret !== undefined)
				return ret;
			var errorMsg = "CheerpX: Calling Flash methods from JS is not supported: "+p;
			f.contentWindow.postMessage({t:"failure",msg:errorMsg}, "*");
			return new Function("var errorMsg='" + errorMsg + "';console.warn(errorMsg);throw new Error(errorMsg);");
		}
	};
	f.__proto__ = new Proxy(oldProto, handlers);
	return true;
}
function ppMutationObserver(e)
{
	for(var i=0;i<e.length;i++)
	{
		var addedNodes = [].slice.call(e[i].addedNodes);
		while(addedNodes.length)
		{
			var n = addedNodes.pop();
			var lowerCaseNodeName = n.nodeName.toLowerCase();
			if(lowerCaseNodeName == "object" || lowerCaseNodeName == "embed")
			{
				if(rewriteFlashObject(n, ppCheerpXAppOpts))
					continue;
			}
			if(n.hasChildNodes())
			{
				addedNodes = addedNodes.concat([].slice.call(n.children));
			}
		}
	}
}
function ppInit(args)
{
	if(args)
	{
		if(args.urlFilterCallback)
			ppUrlFilterCb = args.urlFilterCallback;
		if(args.locationHref)
			ppLocationHref = args.locationHref;
		if(args.bridgeURL)
			ppCheerpXAppOpts.bridgeURL = args.bridgeURL;
	}
	var elemNames = ["object", "embed"];
	for(var i=0;i<elemNames.length;i++)
	{
		var elems = document.getElementsByTagName(elemNames[i]);
		var a = [];
		for(var j=0;j<elems.length;j++)
			a.push(elems[j]);
		for(var j=0;j<a.length;j++)
			rewriteFlashObject(a[j], ppCheerpXAppOpts);
	}
	var tagObserver = new MutationObserver(ppMutationObserver);
	tagObserver.observe(document, { subtree: true, childList: true });
}
