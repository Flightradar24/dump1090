// Define our global variables
var GoogleMap     = null;
var Planes        = {};
var PlanesOnMap   = 0;
var PlanesOnTable = 0;
var PlanesToReap  = 0;
var SelectedPlane = null;

var iSortCol=-1;
var bSortASC=true;
var bDefaultSortASC=true;
var iDefaultSortCol=3;

// Get current map settings
CenterLat = Number(localStorage['CenterLat']) || CONST_CENTERLAT;
CenterLon = Number(localStorage['CenterLon']) || CONST_CENTERLON;
ZoomLvl   = Number(localStorage['ZoomLvl']) || CONST_ZOOMLVL;

function fetchData() {
	$.getJSON('/dump1090/data.json', function(data) {
		PlanesOnMap = 0
		
		// Loop through all the planes in the data packet
		for (var j=0; j < data.length; j++) {
			// Do we already have this plane object in Planes?
			// If not make it.
			if (Planes[data[j].hex]) {
				var plane = Planes[data[j].hex];
			} else {
				var plane = jQuery.extend(true, {}, planeObject);
			}

			// Call the function update
			plane.funcUpdateData(data[j]);
			
			// Copy the plane into Planes
			Planes[plane.icao] = plane;
		}

		PlanesOnTable = data.length;
	});
}

// Initalizes the map and starts up our timers to call various functions
function initialize() {
	// Make a list of all the available map IDs
	var mapTypeIds = [];
	for(var type in google.maps.MapTypeId) {
		mapTypeIds.push(google.maps.MapTypeId[type]);
	}
	// Push OSM on to the end
	mapTypeIds.push("OSM");
	mapTypeIds.push("dark_map");

	// Styled Map to outline airports and highways
	var styles = [
		{
			"featureType": "administrative",
			"stylers": [
				{ "visibility": "off" }
			]
		},{
			"featureType": "landscape",
			"stylers": [
				{ "visibility": "off" }
			]
		},{
			"featureType": "poi",
			"stylers": [
				{ "visibility": "off" }
			]
		},{
			"featureType": "road",
			"stylers": [
				{ "visibility": "off" }
			]
		},{
			"featureType": "transit",
			"stylers": [
				{ "visibility": "off" }
			]
		},{
			"featureType": "landscape",
			"stylers": [
				{ "visibility": "on" },
				{ "weight": 8 },
				{ "color": "#000000" }
			]
		},{
			"featureType": "water",
			"stylers": [
			{ "lightness": -74 }
			]
		},{
			"featureType": "transit.station.airport",
			"stylers": [
				{ "visibility": "on" },
				{ "weight": 8 },
				{ "invert_lightness": true },
				{ "lightness": 27 }
			]
		},{
			"featureType": "road.highway",
			"stylers": [
				{ "visibility": "simplified" },
				{ "invert_lightness": true },
				{ "gamma": 0.3 }
			]
		},{
			"featureType": "road",
			"elementType": "labels",
			"stylers": [
				{ "visibility": "off" }
			]
		}
	]

	// Add our styled map
	var styledMap = new google.maps.StyledMapType(styles, {name: "Dark Map"});

	// Define the Google Map
	var mapOptions = {
		center: new google.maps.LatLng(CenterLat, CenterLon),
		zoom: ZoomLvl,
		mapTypeId: google.maps.MapTypeId.ROADMAP,
		mapTypeControlOptions: {
			mapTypeIds: mapTypeIds,
		}
	};

	GoogleMap = new google.maps.Map(document.getElementById("map_canvas"), mapOptions);

	//Define OSM map type pointing at the OpenStreetMap tile server
	GoogleMap.mapTypes.set("OSM", new google.maps.ImageMapType({
		getTileUrl: function(coord, zoom) {
			return "http://tile.openstreetmap.org/" + zoom + "/" + coord.x + "/" + coord.y + ".png";
		},
		tileSize: new google.maps.Size(256, 256),
		name: "OpenStreetMap",
		maxZoom: 18
	}));

	GoogleMap.mapTypes.set("dark_map", styledMap);

	// Did our crafty user need some setup?
	extendedInitalize();
	
	// Setup our timer to poll from the server.
	window.setInterval(function() {
		fetchData();
		refreshTableInfo();
		refreshSelected()
		reaper();
		extendedPulse();
	}, 1000);
}

// This looks for planes to reap out of the master Planes variable
function reaper() {
	PlanesToReap = 0;
	// When did the reaper start?
	reaptime = new Date().getTime();
	// Loop the planes
	for (var reap in Planes) {
		// Is this plane possibly reapable?
		if (Planes[reap].reapable == true) {
			// Has it not been seen for 5 minutes?
			// This way we still have it if it returns before then
			// Due to loss of signal or other reasons
			if ((reaptime - Planes[reap].updated) > 300000) {
				// Reap it.
				delete Planes[reap];
			}
			PlanesToReap++;
		}
	};
} 

// Refresh the detail window about the plane
// TODO: Find out why when deselecting it sticks
function refreshSelected() {
	if ((	SelectedPlane != "ICAO") && (SelectedPlane != null)) {
		var selected = Planes[SelectedPlane];
		if (selected.flight == "") {
			selected.flight="N/A (" + selected.icao + ")";
		}
		var html = '<table id="selectedinfo" width="100%">';
		html += '<tr><td colspan="2" id="selectedinfotitle"><b>' + selected.flight + '</b><td></tr>';
		// Lets hope we never see this... Aircraft Hijacking
		if (selected.squawk == 7500) {
			html += '<tr><td colspan="2"id="selectedinfotitle">Squawking: Aircraft Hijacking</td>'
		}
		// Radio Failure
		if (selected.squawk == 7600) {
			html += '<tr><td colspan="2" id="selectedinfotitle">Squawking: Communication Loss (Radio Failure)</td>'
		}
		// Emergancy
		if (selected.squawk == 7700) {
			html += '<tr><td colspan="2" id="selectedinfotitle">Squawking: Emergancy</td>'
		}
		html += '<tr><td>Altitude: ' + selected.altitude + '</td><td>Squawk: ' + selected.squawk + '</td></tr>';
		html += '<tr><td>Track: ' + selected.track + ' (' + normalizeTrack(selected.track, selected.vTrack)[1] +')</td><td>ICAO (hex): ' + selected.icao + '</td></tr>';
		html += '<tr><td colspan="2" align="center">Lat/Long: ' + selected.latitude + ', ' + selected.longitude + '</td></tr>';
		html += '</table>';
	} else {
		var html = '';
	}
	document.getElementById('plane_detail').innerHTML = html;
}

// Right now we have no means to validate the speed is good
// Want to return (n/a) when we dont have it
// TODO: Edit C code to add a valid speed flag
// TODO: Edit js code to use said flag
function normalizeSpeed(speed, valid) {
	return speed	
}

// Returns back a long string, short string, and the track if we have a vaild track path
function normalizeTrack(track, valid){
	x = []
	if ((track > -1) && (track < 22.5)) {
		x = ["North", "N", track]
	}
	if ((track > 22.5) && (track < 67.5)) {
		x = ["North East", "NE", track]
	}
	if ((track > 67.5) && (track < 112.5)) {
		x = ["East", "E", track]
	}
	if ((track > 112.5) && (track < 157.5)) {
		x = ["South East", "SE", track]
	}
	if ((track > 157.5) && (track < 202.5)) {
		x = ["South", "S", track]
	}
	if ((track > 202.5) && (track < 247.5)) {
		x = ["South West", "SW", track]
	}
	if ((track > 247.5) && (track < 292.5)) {
		x = ["West", "W", track]
	}
	if ((track > 292.5) && (track < 337.5)) {
		x = ["North West", "NW", track]
	}
	if ((track > 337.5) && (track < 361)) {
		x = ["North", "N", track]
	}
	if (!valid) {
		x = [" ", "n/a", ""]
	}
	return x
}

// Refeshes the larger table of all the planes
function refreshTableInfo() {
	var html = '<table id="tableinfo" width="100%">';
	html += '<thead style="background-color: #BBBBBB; cursor: pointer;">';
	html += '<td onclick="setASC_DESC(\'0\');sortTable(\'tableinfo\',\'0\');">ICAO</td>';
	html += '<td onclick="setASC_DESC(\'1\');sortTable(\'tableinfo\',\'1\');">Flight</td>';
	html += '<td onclick="setASC_DESC(\'2\');sortTable(\'tableinfo\',\'2\');" align="right">Squawk</td>';
	html += '<td onclick="setASC_DESC(\'3\');sortTable(\'tableinfo\',\'3\');" align="right">Altitude</td>';
	html += '<td onclick="setASC_DESC(\'4\');sortTable(\'tableinfo\',\'4\');" align="right">Speed</td>';
	html += '<td onclick="setASC_DESC(\'5\');sortTable(\'tableinfo\',\'5\');" align="right">Track</td>';
	html += '<td onclick="setASC_DESC(\'6\');sortTable(\'tableinfo\',\'6\');" align="right">Msgs</td>';
	html += '<td onclick="setASC_DESC(\'7\');sortTable(\'tableinfo\',\'7\');" align="right">Seen</td></thead><tbody>';
	for (var tablep in Planes) {
		var tableplane = Planes[tablep]
		if (!tableplane.reapable) {
			var specialStyle = "";
			// Is this the plane we selected?
			if (tableplane.icao == SelectedPlane) {
				specialStyle += " selected";
			}
			// Lets hope we never see this... Aircraft Hijacking
			if (tableplane.squawk == 7500) {
				specialStyle += " squawk7500";
			}
			// Radio Failure
			if (tableplane.squawk == 7600) {
				specialStyle += " squawk7600";
			}
			// Emergancy
			if (tableplane.squawk == 7700) {
				specialStyle += " squawk7700";
			}
			if (tableplane.vPosition == true)
				html += '<tr class="plane_table_row vPosition' + specialStyle + '">';
			else
				html += '<tr class="plane_table_row ' + specialStyle + '">';
			html += '<td>' + tableplane.icao + '</td>';
			html += '<td>' + tableplane.flight + '</td>';
			html += '<td align="right">' + tableplane.squawk + '</td>';
			html += '<td align="right">' + tableplane.altitude + '</td>';
			html += '<td align="right">' + tableplane.speed + '</td>';
			html += '<td align="right">' + normalizeTrack(tableplane.track, tableplane.vTrack)[2] + ' (' + normalizeTrack(tableplane.track, tableplane.vTrack)[1] + ')</td>';
			html += '<td align="right">' + tableplane.messages + '</td>';
			html += '<td align="right">' + tableplane.seen + '</td>';
			html += '</tr>';
		}
	}
	html += '</tbody></table>';

	document.getElementById('planes_table').innerHTML = html;

	// Click event for table
	$('#planes_table').find('tr').click( function(){
		var hex = $(this).find('td:first').text();
		if (hex != "ICAO") {
			selectPlaneByHex(hex);
			refreshTableInfo()
			refreshSelected()
		}
	});

	sortTable("tableinfo");
}

// Credit goes to a co-worker that needed a similar functions for something else
// we get a copy of it free ;)
function setASC_DESC(iCol) {
	if(iSortCol==iCol) {
		bSortASC=!bSortASC;
	} else {
		bSortASC=bDefaultSortASC;
	}
}

function sortTable(szTableID,iCol) { 
	//if iCol was not provided, and iSortCol is not set, assign default value
	if (typeof iCol==='undefined'){
		if(iSortCol!=-1){
			var iCol=iSortCol;
		} else {
			var iCol=iDefaultSortCol;
		}
	}

	//retrieve passed table element
	var oTbl=document.getElementById(szTableID).tBodies[0];
	var aStore=[];

	//If supplied col # is greater than the actual number of cols, set sel col = to last col
	if (oTbl.rows[0].cells.length<=iCol)
		iCol=(oTbl.rows[0].cells.length-1);

	//store the col #
	iSortCol=iCol;

	//determine if we are delaing with numerical, or alphanumeric content
	bNumeric=!isNaN(parseFloat(oTbl.rows[0].cells[iSortCol].textContent||oTbl.rows[0].cells[iSortCol].innerText))?true:false;

	//loop through the rows, storing each one inro aStore
	for (var i=0,iLen=oTbl.rows.length;i<iLen;i++){
		var oRow=oTbl.rows[i];
		vColData=bNumeric?parseFloat(oRow.cells[iSortCol].textContent||oRow.cells[iSortCol].innerText):String(oRow.cells[iSortCol].textContent||oRow.cells[iSortCol].innerText);
		aStore.push([vColData,oRow]);
	}

	//sort aStore ASC/DESC based on value of bSortASC
	if(bNumeric){//numerical sort
		aStore.sort(function(x,y){return bSortASC?x[0]-y[0]:y[0]-x[0];});
	}else{//alpha sort
		aStore.sort();
		if(!bSortASC)
			aStore.reverse();
	}

	//rewrite the table rows to the passed table element
	for(var i=0,iLen=aStore.length;i<iLen;i++){
		oTbl.appendChild(aStore[i][1]);
	}
	aStore=null;
}

function selectPlaneByHex(hex) {
	// If SelectedPlane has something in it, clear out the selected
	if (SelectedPlane != null) {
		Planes[SelectedPlane].is_selected = false;
		Planes[SelectedPlane].funcClearLine();
		Planes[SelectedPlane].markerColor = MarkerColor;
		// If the selected has a marker, make it not stand out
		if (Planes[SelectedPlane].marker) {
			Planes[SelectedPlane].marker.setIcon(Planes[SelectedPlane].funcGetIcon());
		}
	}

	// If we are clicking the same plane, we are deselected it.
	if (String(SelectedPlane) != String(hex)) {
		// Assign the new selected
		SelectedPlane = hex;
		Planes[SelectedPlane].is_selected = true;
		// If the selected has a marker, make it stand out
		if (Planes[SelectedPlane].marker) {
			Planes[SelectedPlane].funcUpdateLines();
			Planes[SelectedPlane].marker.setIcon(Planes[SelectedPlane].funcGetIcon());
		}
	}
}
