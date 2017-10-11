#!/bin/bash
mkdir -p expectations/platforms/gtk
mkdir -p results

wget -O results/gtk-release.json "https://webkit-test-results.webkit.org/testfile?builder=GTK%20Linux%2064-bit%20Release%20(Tests)&master=webkit.org&testtype=layout-tests&name=results-small.json"
wget -O expectations/TestExpectations https://svn.webkit.org/repository/webkit/trunk/LayoutTests/TestExpectations
wget -O expectations/platforms/gtk/TestExpectations https://svn.webkit.org/repository/webkit/trunk/LayoutTests/platform/gtk/TestExpectations
